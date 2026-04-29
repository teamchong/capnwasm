// Single-pass tape encoder/decoder.
//
// To avoid expensive wasm boundary crossings on a per-node basis, the JS side
// walks the value tree once and writes a compact byte tape into linear memory.
// Zig reads the tape in one call and produces (or consumes) Cap'n Proto bytes.
//
// Tape grammar (little-endian throughout):
//
//   tape       = msg
//   msg        = msg_tag args
//   msg_tag    = u8 in 0x00..0x07 (push|pull|resolve|reject|release|stream|abort|pipe)
//   args       = depends on tag (see msg_args)
//
//   expr       = expr_tag payload
//   expr_tag   = u8
//
//   Expression encoding:
//     0x00 null
//     0x01 true       0x02 false
//     0x03 int        i64
//     0x04 float      f64
//     0x05 text       u32 len, bytes
//     0x06 data       u32 len, bytes
//     0x07 date       f64 ms
//     0x08 bigint     u32 len, decimal text
//     0x09 undefined
//     0x10 array      u32 count, [expr]*
//     0x11 object     u32 count, ([u32 nlen, name, expr])*
//     0x20 import     i64
//     0x21 export     i64
//     0x22 pipeline   expr (source), u32 path_count, [u32 nlen, name]*, u8 has_args, expr?
//     0x23 error      u32 type_len, type, u32 msg_len, msg

const std = @import("std");
const wire = @import("wire.zig");
const rpc = @import("rpc.zig");

pub const TapeReader = struct {
    bytes: []const u8,
    pos: usize = 0,

    pub inline fn readU8(self: *TapeReader) !u8 {
        if (self.pos >= self.bytes.len) return error.TapeUnderflow;
        const b = self.bytes[self.pos];
        self.pos += 1;
        return b;
    }

    pub inline fn readU32(self: *TapeReader) !u32 {
        if (self.pos + 4 > self.bytes.len) return error.TapeUnderflow;
        const v = std.mem.readInt(u32, self.bytes[self.pos..][0..4], .little);
        self.pos += 4;
        return v;
    }

    pub inline fn readI64(self: *TapeReader) !i64 {
        if (self.pos + 8 > self.bytes.len) return error.TapeUnderflow;
        const v = std.mem.readInt(i64, self.bytes[self.pos..][0..8], .little);
        self.pos += 8;
        return v;
    }

    pub inline fn readU64(self: *TapeReader) !u64 {
        if (self.pos + 8 > self.bytes.len) return error.TapeUnderflow;
        const v = std.mem.readInt(u64, self.bytes[self.pos..][0..8], .little);
        self.pos += 8;
        return v;
    }

    pub inline fn readF64(self: *TapeReader) !f64 {
        const bits = try self.readU64();
        return @bitCast(bits);
    }

    pub inline fn readSlice(self: *TapeReader, len: usize) ![]const u8 {
        if (self.pos + len > self.bytes.len) return error.TapeUnderflow;
        const s = self.bytes[self.pos .. self.pos + len];
        self.pos += len;
        return s;
    }
};

pub const TapeWriter = struct {
    bytes: []u8,
    pos: usize = 0,

    pub inline fn writeU8(self: *TapeWriter, v: u8) !void {
        if (self.pos >= self.bytes.len) return error.TapeOverflow;
        self.bytes[self.pos] = v;
        self.pos += 1;
    }

    pub inline fn writeU32(self: *TapeWriter, v: u32) !void {
        if (self.pos + 4 > self.bytes.len) return error.TapeOverflow;
        std.mem.writeInt(u32, self.bytes[self.pos..][0..4], v, .little);
        self.pos += 4;
    }

    pub inline fn writeU64(self: *TapeWriter, v: u64) !void {
        if (self.pos + 8 > self.bytes.len) return error.TapeOverflow;
        std.mem.writeInt(u64, self.bytes[self.pos..][0..8], v, .little);
        self.pos += 8;
    }

    pub inline fn writeI64(self: *TapeWriter, v: i64) !void {
        try self.writeU64(@bitCast(v));
    }

    pub inline fn writeF64(self: *TapeWriter, v: f64) !void {
        try self.writeU64(@bitCast(v));
    }

    pub inline fn writeSlice(self: *TapeWriter, s: []const u8) !void {
        if (self.pos + s.len > self.bytes.len) return error.TapeOverflow;
        @memcpy(self.bytes[self.pos .. self.pos + s.len], s);
        self.pos += s.len;
    }
};

pub const MsgTag = enum(u8) {
    push = 0,
    pull = 1,
    resolve = 2,
    reject = 3,
    release = 4,
    stream = 5,
    abort = 6,
    pipe = 7,
};

pub const ExprTag = enum(u8) {
    null_ = 0x00,
    true_ = 0x01,
    false_ = 0x02,
    int = 0x03,
    float = 0x04,
    text = 0x05,
    data = 0x06,
    date = 0x07,
    bigint = 0x08,
    undefined_ = 0x09,
    array = 0x10,
    object = 0x11,
    import = 0x20,
    export_ = 0x21,
    pipeline = 0x22,
    error_ = 0x23,
};

/// Encode a tape into a Cap'n Proto message. Returns owned bytes.
pub fn encodeTape(allocator: std.mem.Allocator, tape: []const u8) ![]u8 {
    var mb = try buildFromTape(allocator, tape);
    defer mb.deinit();
    return try mb.toBytes(allocator);
}

/// Encode a tape directly into `out`. Returns the number of bytes written.
pub fn encodeTapeInto(allocator: std.mem.Allocator, tape: []const u8, out: []u8) !usize {
    var mb = try buildFromTape(allocator, tape);
    defer mb.deinit();
    const total = mb.framedSize();
    if (total > out.len) return error.OutBufferTooSmall;
    return mb.toBytesInto(out);
}

fn buildFromTape(allocator: std.mem.Allocator, tape: []const u8) !wire.MessageBuilder {
    var tr: TapeReader = .{ .bytes = tape };
    // Heuristic: Cap'n Proto output is roughly 1-2x the tape size for typical
    // payloads. Pre-size the first segment to (tape_len + 1KB) words rounded
    // up to keep us in a single segment for the common case.
    const initial_words: u32 = @intCast(@min(@as(u64, 1) << 16, (tape.len + 1024 + 7) / 8 + 256));
    var mb = try wire.MessageBuilder.init(allocator, initial_words);
    errdefer mb.deinit();

    const tag_byte = try tr.readU8();
    const tag: MsgTag = @enumFromInt(tag_byte);

    switch (tag) {
        .pull => {
            const id = try tr.readI64();
            try rpc.buildPullMessage(&mb, id);
        },
        .release => {
            const id = try tr.readI64();
            const refcount = try tr.readU32();
            try rpc.buildReleaseMessage(&mb, id, refcount);
        },
        .pipe => {
            const root = try mb.initRoot(1, 0);
            root.setU16(0, @intFromEnum(rpc.MessageTag.pipe));
        },
        .push, .stream, .abort => {
            const wire_tag: rpc.MessageTag = switch (tag) {
                .push => .push,
                .stream => .stream,
                .abort => .abort,
                else => unreachable,
            };
            const root = try mb.initRoot(1, 1);
            root.setU16(0, @intFromEnum(wire_tag));
            const expr = try root.initStruct(0, 2, 4);
            try encodeExpr(&mb, expr, &tr);
        },
        .resolve, .reject => {
            const id = try tr.readI64();
            const wire_tag: rpc.MessageTag = if (tag == .resolve) .resolve else .reject;
            const root = try mb.initRoot(2, 1);
            root.setU16(0, @intFromEnum(wire_tag));
            root.setU64(8, @bitCast(id));
            const expr = try root.initStruct(0, 2, 4);
            try encodeExpr(&mb, expr, &tr);
        },
    }

    return mb;
}

fn encodeExpr(mb: *wire.MessageBuilder, b: wire.StructBuilder, tr: *TapeReader) !void {
    const tag_byte = try tr.readU8();
    const tag: ExprTag = @enumFromInt(tag_byte);
    b.setU16(0, @as(u16, tag_byte));
    switch (tag) {
        .null_, .undefined_ => {},
        .true_ => b.setBool(16, true),
        .false_ => b.setBool(16, false),
        .int => b.setU64(8, @bitCast(try tr.readI64())),
        .float => b.setU64(8, try tr.readU64()),
        .date => b.setU64(8, try tr.readU64()),
        .text => {
            const len = try tr.readU32();
            const slice = try tr.readSlice(len);
            try b.setText(0, slice);
        },
        .data => {
            const len = try tr.readU32();
            const slice = try tr.readSlice(len);
            try b.setData(0, slice);
        },
        .bigint => {
            const len = try tr.readU32();
            const slice = try tr.readSlice(len);
            try b.setText(0, slice);
        },
        .import, .export_ => {
            b.setU64(8, @bitCast(try tr.readI64()));
        },
        .array => {
            const count = try tr.readU32();
            const lb = try b.initListComposite(0, count, 2, 4);
            var i: u32 = 0;
            while (i < count) : (i += 1) {
                try encodeExpr(mb, lb.getStruct(i), tr);
            }
        },
        .object => {
            const count = try tr.readU32();
            // An object is a composite list of (name, value) pairs at ptr 0.
            // Each kv struct has 0 data words and 2 ptrs: name (text), value (expression).
            const lb = try b.initListComposite(0, count, 0, 2);
            var i: u32 = 0;
            while (i < count) : (i += 1) {
                const kv = lb.getStruct(i);
                const nlen = try tr.readU32();
                const name = try tr.readSlice(nlen);
                try kv.setText(0, name);
                const v_struct = try kv.initStruct(1, 2, 4);
                try encodeExpr(mb, v_struct, tr);
            }
        },
        .pipeline => {
            const src = try b.initStruct(1, 2, 4);
            try encodeExpr(mb, src, tr);
            const path_count = try tr.readU32();
            const path_lb = try b.initListComposite(2, path_count, 0, 1);
            var i: u32 = 0;
            while (i < path_count) : (i += 1) {
                const seg = path_lb.getStruct(i);
                const nlen = try tr.readU32();
                const name = try tr.readSlice(nlen);
                try seg.setText(0, name);
            }
            const has_args = try tr.readU8();
            if (has_args != 0) {
                const args = try b.initStruct(3, 2, 4);
                try encodeExpr(mb, args, tr);
            }
        },
        .error_ => {
            const type_len = try tr.readU32();
            const type_bytes = try tr.readSlice(type_len);
            const msg_len = try tr.readU32();
            const msg_bytes = try tr.readSlice(msg_len);
            const err_struct = try b.initStruct(1, 0, 2);
            try err_struct.setText(0, type_bytes);
            try err_struct.setText(1, msg_bytes);
        },
    }
}

/// Decode a Cap'n Proto message into a tape.
pub fn decodeMessage(
    allocator: std.mem.Allocator,
    capnp_bytes: []const u8,
    tape_buffer: []u8,
) !usize {
    var parsed = try wire.parseStreamFramed(allocator, capnp_bytes);
    defer parsed.deinit();

    var tw: TapeWriter = .{ .bytes = tape_buffer };
    const root = parsed.root();
    const wire_tag = rpc.readMessageTag(root);

    switch (wire_tag) {
        .pull => {
            try tw.writeU8(@intFromEnum(MsgTag.pull));
            try tw.writeI64(rpc.readPullId(root));
        },
        .release => {
            try tw.writeU8(@intFromEnum(MsgTag.release));
            try tw.writeI64(rpc.readPullId(root));
            try tw.writeU32(rpc.readReleaseRefcount(root));
        },
        .pipe => {
            try tw.writeU8(@intFromEnum(MsgTag.pipe));
        },
        .push, .stream, .abort => {
            const tag: MsgTag = switch (wire_tag) {
                .push => .push,
                .stream => .stream,
                .abort => .abort,
                else => unreachable,
            };
            try tw.writeU8(@intFromEnum(tag));
            try decodeExpr(rpc.readExpression(root), &tw);
        },
        .resolve, .reject => {
            const tag: MsgTag = if (wire_tag == .resolve) .resolve else .reject;
            try tw.writeU8(@intFromEnum(tag));
            try tw.writeI64(rpc.readResolveOrRejectId(root));
            try decodeExpr(rpc.readExpression(root), &tw);
        },
    }
    return tw.pos;
}

fn decodeExpr(reader: wire.StructReader, tw: *TapeWriter) !void {
    const tag_byte: u8 = @truncate(reader.readU16(0, 0));
    const tag: ExprTag = @enumFromInt(tag_byte);
    try tw.writeU8(tag_byte);
    switch (tag) {
        .null_, .undefined_ => {},
        .true_, .false_ => {},
        .int, .import, .export_ => try tw.writeI64(@bitCast(reader.readU64(8, 0))),
        .float, .date => try tw.writeU64(reader.readU64(8, 0)),
        .text => {
            const slice = reader.readText(0);
            try tw.writeU32(@intCast(slice.len));
            try tw.writeSlice(slice);
        },
        .data => {
            const slice = reader.readData(0);
            try tw.writeU32(@intCast(slice.len));
            try tw.writeSlice(slice);
        },
        .bigint => {
            const slice = reader.readText(0);
            try tw.writeU32(@intCast(slice.len));
            try tw.writeSlice(slice);
        },
        .array => {
            const list = reader.readList(0);
            try tw.writeU32(list.count);
            var i: u32 = 0;
            while (i < list.count) : (i += 1) {
                try decodeExpr(list.getStruct(i), tw);
            }
        },
        .object => {
            const list = reader.readList(0);
            try tw.writeU32(list.count);
            var i: u32 = 0;
            while (i < list.count) : (i += 1) {
                const kv = list.getStruct(i);
                const name = kv.readText(0);
                try tw.writeU32(@intCast(name.len));
                try tw.writeSlice(name);
                try decodeExpr(kv.readStruct(1), tw);
            }
        },
        .pipeline => {
            try decodeExpr(reader.readStruct(1), tw);
            const path_list = reader.readList(2);
            try tw.writeU32(path_list.count);
            var i: u32 = 0;
            while (i < path_list.count) : (i += 1) {
                const seg = path_list.getStruct(i);
                const name = seg.readText(0);
                try tw.writeU32(@intCast(name.len));
                try tw.writeSlice(name);
            }
            const args_ptr = reader.readPointerAt(3);
            if (args_ptr.isNull()) {
                try tw.writeU8(0);
            } else {
                try tw.writeU8(1);
                try decodeExpr(reader.readStruct(3), tw);
            }
        },
        .error_ => {
            const err_struct = reader.readStruct(1);
            const type_str = err_struct.readText(0);
            try tw.writeU32(@intCast(type_str.len));
            try tw.writeSlice(type_str);
            const msg_str = err_struct.readText(1);
            try tw.writeU32(@intCast(msg_str.len));
            try tw.writeSlice(msg_str);
        },
    }
}
