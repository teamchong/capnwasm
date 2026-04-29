// Emit a capnweb-shape JS value as JSON bytes, reading directly from a
// Cap'n Proto message. Avoids the intermediate tape entirely on decode: the
// caller can do `JSON.parse(new TextDecoder().decode(out))` and get back the
// fully materialized capnweb-shape value.
//
// JSON encoding follows capnweb's wire conventions:
//   - object   -> {"k":expr,"k":expr}
//   - array    -> [[expr,expr]]                      (capnweb double-wrap)
//   - text     -> "string with JSON escaping"
//   - int/float -> number literal
//   - bool/null -> true|false|null
//   - date      -> ["date", millis]
//   - bytes     -> ["bytes", "base64"]
//   - bigint    -> ["bigint", "decimal"]
//   - import    -> ["import", id]
//   - export    -> ["export", id]
//   - pipeline  -> ["pipeline", source, [path...], args?]
//   - error     -> ["error", "Type", "msg"]
//   - inf/-inf/nan/undef -> ["inf"]|["-inf"]|["nan"]|["undefined"]

const std = @import("std");
const wire = @import("wire.zig");
const rpc = @import("rpc.zig");
const tape_mod = @import("tape.zig");

pub const Writer = struct {
    bytes: []u8,
    pos: usize = 0,

    pub inline fn writeByte(self: *Writer, b: u8) !void {
        if (self.pos >= self.bytes.len) return error.OutBufferTooSmall;
        self.bytes[self.pos] = b;
        self.pos += 1;
    }

    pub inline fn writeAll(self: *Writer, s: []const u8) !void {
        if (self.pos + s.len > self.bytes.len) return error.OutBufferTooSmall;
        @memcpy(self.bytes[self.pos .. self.pos + s.len], s);
        self.pos += s.len;
    }

    /// Write a JSON-escaped string (without surrounding quotes).
    pub fn writeJsonStringContent(self: *Writer, s: []const u8) !void {
        for (s) |c| {
            switch (c) {
                '"' => try self.writeAll("\\\""),
                '\\' => try self.writeAll("\\\\"),
                '\n' => try self.writeAll("\\n"),
                '\r' => try self.writeAll("\\r"),
                '\t' => try self.writeAll("\\t"),
                0x08 => try self.writeAll("\\b"),
                0x0C => try self.writeAll("\\f"),
                0...7, 0x0B, 0x0E...0x1F => {
                    try self.writeAll("\\u00");
                    const hex = "0123456789abcdef";
                    try self.writeByte(hex[c >> 4]);
                    try self.writeByte(hex[c & 0xF]);
                },
                else => try self.writeByte(c),
            }
        }
    }

    pub fn writeQuoted(self: *Writer, s: []const u8) !void {
        try self.writeByte('"');
        try self.writeJsonStringContent(s);
        try self.writeByte('"');
    }

    /// Write a signed integer as decimal text. Hand-rolled to avoid pulling
    /// in std.fmt's full formatting infrastructure (which is large).
    pub fn writeI64(self: *Writer, v: i64) !void {
        var buf: [24]u8 = undefined;
        var pos: usize = buf.len;
        var n: u64 = if (v < 0) @as(u64, @intCast(-(v + 1))) + 1 else @intCast(v);
        while (true) {
            pos -= 1;
            buf[pos] = @intCast('0' + n % 10);
            n /= 10;
            if (n == 0) break;
        }
        if (v < 0) {
            pos -= 1;
            buf[pos] = '-';
        }
        try self.writeAll(buf[pos..]);
    }

    /// Write an f64 as JSON-compatible text. Non-integer floats fall back
    /// through std.fmt (Ryu-style formatter) — accepts the size cost only
    /// when actually used.
    pub fn writeF64(self: *Writer, v: f64) !void {
        if (std.math.isNan(v) or std.math.isInf(v)) return error.NonFiniteFloat;
        if (v >= -9007199254740992.0 and v <= 9007199254740992.0 and @floor(v) == v) {
            try self.writeI64(@intFromFloat(v));
            return;
        }
        var buf: [32]u8 = undefined;
        const text = std.fmt.bufPrint(&buf, "{d}", .{v}) catch unreachable;
        try self.writeAll(text);
    }
};

pub fn emitMessage(reader: wire.StructReader, w: *Writer) !void {
    const tag = rpc.readMessageTag(reader);
    try w.writeByte('[');
    switch (tag) {
        .push => {
            try w.writeAll("\"push\",");
            try emitExpression(rpc.readExpression(reader), w);
        },
        .pull => {
            try w.writeAll("\"pull\",");
            try w.writeI64(rpc.readPullId(reader));
        },
        .resolve => {
            try w.writeAll("\"resolve\",");
            try w.writeI64(rpc.readResolveOrRejectId(reader));
            try w.writeByte(',');
            try emitExpression(rpc.readExpression(reader), w);
        },
        .reject => {
            try w.writeAll("\"reject\",");
            try w.writeI64(rpc.readResolveOrRejectId(reader));
            try w.writeByte(',');
            try emitExpression(rpc.readExpression(reader), w);
        },
        .release => {
            try w.writeAll("\"release\",");
            try w.writeI64(rpc.readPullId(reader));
            try w.writeByte(',');
            const refcount: i64 = @intCast(rpc.readReleaseRefcount(reader));
            try w.writeI64(refcount);
        },
        .stream => {
            try w.writeAll("\"stream\",");
            try emitExpression(rpc.readExpression(reader), w);
        },
        .abort => {
            try w.writeAll("\"abort\",");
            try emitExpression(rpc.readExpression(reader), w);
        },
        .pipe => try w.writeAll("\"pipe\""),
    }
    try w.writeByte(']');
}

fn emitExpression(reader: wire.StructReader, w: *Writer) !void {
    // Wire-format expression tags use the tape ExprTag values (the tape encoder
    // writes its own tag byte directly into the u16 at offset 0 of the data
    // section). See src/tape.zig for the full tag table.
    const tag_byte: u8 = @truncate(reader.readU16(0, 0));
    const tag: tape_mod.ExprTag = @enumFromInt(tag_byte);
    switch (tag) {
        .null_ => try w.writeAll("null"),
        .undefined_ => try w.writeAll("[\"undefined\"]"),
        .true_ => try w.writeAll("true"),
        .false_ => try w.writeAll("false"),
        .int => try w.writeI64(@bitCast(reader.readU64(8, 0))),
        .float => {
            const f: f64 = @bitCast(reader.readU64(8, 0));
            if (std.math.isNan(f)) try w.writeAll("[\"nan\"]")
            else if (std.math.isInf(f) and f > 0) try w.writeAll("[\"inf\"]")
            else if (std.math.isInf(f)) try w.writeAll("[\"-inf\"]")
            else try w.writeF64(f);
        },
        .text => {
            try w.writeQuoted(reader.readText(0));
        },
        .data => {
            try w.writeAll("[\"bytes\",\"");
            try writeBase64(reader.readData(0), w);
            try w.writeAll("\"]");
        },
        .date => {
            try w.writeAll("[\"date\",");
            const f: f64 = @bitCast(reader.readU64(8, 0));
            try w.writeF64(f);
            try w.writeByte(']');
        },
        .bigint => {
            try w.writeAll("[\"bigint\",");
            try w.writeQuoted(reader.readText(0));
            try w.writeByte(']');
        },
        .array => {
            const list = reader.readList(0);
            try w.writeAll("[[");
            var i: u32 = 0;
            while (i < list.count) : (i += 1) {
                if (i > 0) try w.writeByte(',');
                try emitExpression(list.getStruct(i), w);
            }
            try w.writeAll("]]");
        },
        .object => {
            const list = reader.readList(0);
            try w.writeByte('{');
            var i: u32 = 0;
            while (i < list.count) : (i += 1) {
                if (i > 0) try w.writeByte(',');
                const kv = list.getStruct(i);
                try w.writeQuoted(kv.readText(0));
                try w.writeByte(':');
                try emitExpression(kv.readStruct(1), w);
            }
            try w.writeByte('}');
        },
        .import => {
            try w.writeAll("[\"import\",");
            try w.writeI64(@bitCast(reader.readU64(8, 0)));
            try w.writeByte(']');
        },
        .export_ => {
            try w.writeAll("[\"export\",");
            try w.writeI64(@bitCast(reader.readU64(8, 0)));
            try w.writeByte(']');
        },
        .pipeline => {
            try w.writeAll("[\"pipeline\",");
            try emitExpression(reader.readStruct(1), w);
            try w.writeAll(",[");
            const path = reader.readList(2);
            var i: u32 = 0;
            while (i < path.count) : (i += 1) {
                if (i > 0) try w.writeByte(',');
                try w.writeQuoted(path.getStruct(i).readText(0));
            }
            try w.writeByte(']');
            const args_ptr = reader.readPointerAt(3);
            if (!args_ptr.isNull()) {
                try w.writeByte(',');
                try emitExpression(reader.readStruct(3), w);
            }
            try w.writeByte(']');
        },
        .error_ => {
            try w.writeAll("[\"error\",");
            const err = reader.readStruct(1);
            try w.writeQuoted(err.readText(0));
            try w.writeByte(',');
            try w.writeQuoted(err.readText(1));
            try w.writeByte(']');
        },
    }
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn writeBase64(src: []const u8, w: *Writer) !void {
    var i: usize = 0;
    while (i + 3 <= src.len) : (i += 3) {
        const b0 = src[i];
        const b1 = src[i + 1];
        const b2 = src[i + 2];
        try w.writeByte(B64_CHARS[b0 >> 2]);
        try w.writeByte(B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]);
        try w.writeByte(B64_CHARS[((b1 & 0x0F) << 2) | (b2 >> 6)]);
        try w.writeByte(B64_CHARS[b2 & 0x3F]);
    }
    const rem = src.len - i;
    if (rem == 1) {
        const b0 = src[i];
        try w.writeByte(B64_CHARS[b0 >> 2]);
        try w.writeByte(B64_CHARS[(b0 & 0x03) << 4]);
        try w.writeAll("==");
    } else if (rem == 2) {
        const b0 = src[i];
        const b1 = src[i + 1];
        try w.writeByte(B64_CHARS[b0 >> 2]);
        try w.writeByte(B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]);
        try w.writeByte(B64_CHARS[(b1 & 0x0F) << 2]);
        try w.writeByte('=');
    }
}

/// Decode a Cap'n Proto message into JSON bytes.
pub fn decodeToJson(
    allocator: std.mem.Allocator,
    capnp_bytes: []const u8,
    out: []u8,
) !usize {
    var parsed = try wire.parseStreamFramed(allocator, capnp_bytes);
    defer parsed.deinit();
    var w: Writer = .{ .bytes = out };
    try emitMessage(parsed.root(), &w);
    return w.pos;
}
