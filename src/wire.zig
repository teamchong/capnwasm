// Cap'n Proto wire format core: pointers, segments, struct/list reader+builder.
// Encoding spec: https://capnproto.org/encoding.html
//
// Layout invariants:
//   word = 8 bytes
//   pointer = 1 word (64 bits, little-endian)
//   segment = aligned slice of words

const std = @import("std");

pub const word_size: usize = 8;
pub const max_segments: u32 = 1 << 16;
pub const max_segment_words: u32 = 1 << 28;

pub const PointerKind = enum(u2) {
    struct_ = 0,
    list = 1,
    far = 2,
    other = 3,
};

pub const ElementSize = enum(u3) {
    void_ = 0,
    bit = 1,
    byte = 2,
    two_bytes = 3,
    four_bytes = 4,
    eight_bytes = 5,
    pointer = 6,
    composite = 7,

    pub fn dataBytes(self: ElementSize) u8 {
        return switch (self) {
            .void_ => 0,
            .bit => 0,
            .byte => 1,
            .two_bytes => 2,
            .four_bytes => 4,
            .eight_bytes => 8,
            .pointer => 0,
            .composite => 0,
        };
    }
};

/// Raw 64-bit pointer (little-endian on the wire).
pub const Pointer = packed struct(u64) {
    raw: u64,

    pub fn fromBytes(b: [8]u8) Pointer {
        return .{ .raw = std.mem.readInt(u64, &b, .little) };
    }

    pub fn toBytes(self: Pointer) [8]u8 {
        var b: [8]u8 = undefined;
        std.mem.writeInt(u64, &b, self.raw, .little);
        return b;
    }

    pub fn isNull(self: Pointer) bool {
        return self.raw == 0;
    }

    pub fn kind(self: Pointer) PointerKind {
        return @enumFromInt(@as(u2, @truncate(self.raw)));
    }

    /// For struct/list: signed offset in words from end of pointer to target.
    pub fn offset(self: Pointer) i32 {
        const raw30: u32 = @as(u32, @truncate(self.raw >> 2)) & 0x3FFF_FFFF;
        const sign_bit = raw30 & 0x2000_0000;
        if (sign_bit != 0) {
            return @bitCast(raw30 | 0xC000_0000);
        }
        return @bitCast(raw30);
    }

    pub fn structDataSize(self: Pointer) u16 {
        return @truncate(self.raw >> 32);
    }

    pub fn structPtrSize(self: Pointer) u16 {
        return @truncate(self.raw >> 48);
    }

    pub fn listElemSize(self: Pointer) ElementSize {
        return @enumFromInt(@as(u3, @truncate(self.raw >> 32)));
    }

    pub fn listElemCount(self: Pointer) u32 {
        return @as(u32, @truncate(self.raw >> 35)) & 0x1FFF_FFFF;
    }

    pub fn farIsDouble(self: Pointer) bool {
        return ((self.raw >> 2) & 1) != 0;
    }

    pub fn farOffset(self: Pointer) u32 {
        return @as(u32, @truncate(self.raw >> 3)) & 0x1FFF_FFFF;
    }

    pub fn farSegment(self: Pointer) u32 {
        return @truncate(self.raw >> 32);
    }

    pub fn otherSubKind(self: Pointer) u30 {
        return @truncate(self.raw >> 2);
    }

    pub fn capIndex(self: Pointer) u32 {
        return @truncate(self.raw >> 32);
    }

    pub fn makeStruct(off: i32, data_words: u16, ptr_words: u16) Pointer {
        const off30: u32 = @as(u32, @bitCast(off)) & 0x3FFF_FFFF;
        const raw: u64 = @as(u64, off30) << 2 |
            @as(u64, data_words) << 32 |
            @as(u64, ptr_words) << 48;
        return .{ .raw = raw };
    }

    pub fn makeList(off: i32, elem: ElementSize, count: u32) Pointer {
        const off30: u32 = @as(u32, @bitCast(off)) & 0x3FFF_FFFF;
        const raw: u64 = 1 |
            @as(u64, off30) << 2 |
            @as(u64, @intFromEnum(elem)) << 32 |
            @as(u64, count & 0x1FFF_FFFF) << 35;
        return .{ .raw = raw };
    }

    pub fn makeFar(double: bool, off: u32, segment: u32) Pointer {
        const raw: u64 = 2 |
            (if (double) @as(u64, 1) else 0) << 2 |
            @as(u64, off & 0x1FFF_FFFF) << 3 |
            @as(u64, segment) << 32;
        return .{ .raw = raw };
    }

    pub fn makeCap(index: u32) Pointer {
        const raw: u64 = 3 | (@as(u64, index) << 32);
        return .{ .raw = raw };
    }
};

/// A single segment as a slice of bytes. Length must be multiple of 8.
pub const Segment = struct {
    bytes: []align(8) u8,

    pub fn words(self: Segment) usize {
        return self.bytes.len / word_size;
    }

    pub fn readPtr(self: Segment, word_idx: usize) Pointer {
        const off = word_idx * word_size;
        var b: [8]u8 = undefined;
        @memcpy(&b, self.bytes[off..][0..8]);
        return Pointer.fromBytes(b);
    }

    pub fn writePtr(self: Segment, word_idx: usize, p: Pointer) void {
        const off = word_idx * word_size;
        const b = p.toBytes();
        @memcpy(self.bytes[off..][0..8], &b);
    }

    pub fn data(self: Segment, word_idx: usize, byte_off: usize, comptime T: type) T {
        const off = word_idx * word_size + byte_off;
        return std.mem.readInt(T, self.bytes[off..][0..@sizeOf(T)], .little);
    }

    pub fn writeData(self: Segment, word_idx: usize, byte_off: usize, comptime T: type, value: T) void {
        const off = word_idx * word_size + byte_off;
        std.mem.writeInt(T, self.bytes[off..][0..@sizeOf(T)], value, .little);
    }
};

/// Multi-segment message.
pub const Message = struct {
    segments: []Segment,

    pub fn root(self: *const Message) StructReader {
        return StructReader.fromPointer(self.segments, 0, self.segments[0].readPtr(0), 0);
    }
};

/// Read-only struct view.
pub const StructReader = struct {
    segments: []Segment,
    segment_idx: u32,
    data_word: u32,
    data_words: u16,
    ptr_words: u16,
    nesting_limit: i32,

    pub fn fromPointer(
        segments: []Segment,
        seg_idx: u32,
        ptr: Pointer,
        ptr_word: u32,
    ) StructReader {
        if (ptr.isNull()) return empty();
        return resolvePointer(segments, seg_idx, ptr, ptr_word, 64);
    }

    fn resolvePointer(
        segments: []Segment,
        seg_idx: u32,
        ptr_in: Pointer,
        ptr_word: u32,
        depth: i32,
    ) StructReader {
        var ptr = ptr_in;
        var cur_seg = seg_idx;
        var base_word: i64 = @as(i64, ptr_word) + 1;

        if (ptr.kind() == .far) {
            const target_seg = ptr.farSegment();
            if (target_seg >= segments.len) return empty();
            const land_off = ptr.farOffset();
            const seg = segments[target_seg];
            if (ptr.farIsDouble()) {
                if (land_off + 2 > seg.words()) return empty();
                const land = seg.readPtr(land_off);
                const tag = seg.readPtr(land_off + 1);
                if (land.kind() != .far or land.farIsDouble()) return empty();
                cur_seg = land.farSegment();
                base_word = land.farOffset();
                ptr = tag;
            } else {
                if (land_off >= seg.words()) return empty();
                ptr = seg.readPtr(land_off);
                cur_seg = target_seg;
                base_word = @as(i64, land_off) + 1;
            }
        }

        if (ptr.kind() != .struct_) return empty();

        const dw = ptr.structDataSize();
        const pw = ptr.structPtrSize();
        const off = ptr.offset();
        const target = base_word + @as(i64, off);
        if (target < 0) return empty();
        const tw: u32 = @intCast(target);
        const seg = segments[cur_seg];
        if (@as(usize, tw) + dw + pw > seg.words()) return empty();

        return .{
            .segments = segments,
            .segment_idx = cur_seg,
            .data_word = tw,
            .data_words = dw,
            .ptr_words = pw,
            .nesting_limit = depth - 1,
        };
    }

    pub fn empty() StructReader {
        return .{
            .segments = &[_]Segment{},
            .segment_idx = 0,
            .data_word = 0,
            .data_words = 0,
            .ptr_words = 0,
            .nesting_limit = 0,
        };
    }

    pub fn isEmpty(self: StructReader) bool {
        return self.data_words == 0 and self.ptr_words == 0;
    }

    pub fn readU8(self: StructReader, byte_off: u32, default: u8) u8 {
        const word = byte_off / 8;
        const off = byte_off % 8;
        if (word >= self.data_words) return default;
        const seg = self.segments[self.segment_idx];
        return seg.data(self.data_word + word, off, u8) ^ default;
    }

    pub fn readU16(self: StructReader, byte_off: u32, default: u16) u16 {
        const word = byte_off / 8;
        const off = byte_off % 8;
        if (word >= self.data_words) return default;
        const seg = self.segments[self.segment_idx];
        return seg.data(self.data_word + word, off, u16) ^ default;
    }

    pub fn readU32(self: StructReader, byte_off: u32, default: u32) u32 {
        const word = byte_off / 8;
        const off = byte_off % 8;
        if (word >= self.data_words) return default;
        const seg = self.segments[self.segment_idx];
        return seg.data(self.data_word + word, off, u32) ^ default;
    }

    pub fn readU64(self: StructReader, byte_off: u32, default: u64) u64 {
        const word = byte_off / 8;
        if (word >= self.data_words) return default;
        const seg = self.segments[self.segment_idx];
        return seg.data(self.data_word + word, 0, u64) ^ default;
    }

    pub fn readBool(self: StructReader, bit_off: u32, default: bool) bool {
        const byte = bit_off / 8;
        const bit: u3 = @truncate(bit_off % 8);
        const word = byte / 8;
        const byte_in_word = byte % 8;
        if (word >= self.data_words) return default;
        const seg = self.segments[self.segment_idx];
        const b = seg.data(self.data_word + word, byte_in_word, u8);
        return ((b >> bit) & 1) != @intFromBool(default);
    }

    pub fn readPointerAt(self: StructReader, idx: u16) Pointer {
        if (idx >= self.ptr_words) return .{ .raw = 0 };
        const seg = self.segments[self.segment_idx];
        return seg.readPtr(self.data_word + self.data_words + idx);
    }

    pub fn readStruct(self: StructReader, idx: u16) StructReader {
        if (idx >= self.ptr_words or self.nesting_limit <= 0) return empty();
        const ptr_word = self.data_word + self.data_words + idx;
        const ptr = self.segments[self.segment_idx].readPtr(ptr_word);
        return resolvePointer(self.segments, self.segment_idx, ptr, ptr_word, self.nesting_limit);
    }

    pub fn readList(self: StructReader, idx: u16) ListReader {
        if (idx >= self.ptr_words or self.nesting_limit <= 0) return ListReader.empty();
        const ptr_word = self.data_word + self.data_words + idx;
        const ptr = self.segments[self.segment_idx].readPtr(ptr_word);
        return ListReader.fromPointer(self.segments, self.segment_idx, ptr, ptr_word, self.nesting_limit);
    }

    pub fn readText(self: StructReader, idx: u16) []const u8 {
        const list = self.readList(idx);
        if (list.elem_size != .byte or list.count == 0) return "";
        const seg = list.segments[list.segment_idx];
        const start = list.data_word * word_size;
        return seg.bytes[start .. start + list.count - 1];
    }

    pub fn readData(self: StructReader, idx: u16) []const u8 {
        const list = self.readList(idx);
        if (list.elem_size != .byte) return &[_]u8{};
        const seg = list.segments[list.segment_idx];
        const start = list.data_word * word_size;
        return seg.bytes[start .. start + list.count];
    }
};

/// Read-only list view.
pub const ListReader = struct {
    segments: []Segment,
    segment_idx: u32,
    data_word: u32,
    elem_data_words: u16 = 0,
    elem_ptr_words: u16 = 0,
    step_bits: u32 = 0,
    elem_size: ElementSize,
    count: u32,
    nesting_limit: i32,

    pub fn empty() ListReader {
        return .{
            .segments = &[_]Segment{},
            .segment_idx = 0,
            .data_word = 0,
            .elem_size = .void_,
            .count = 0,
            .nesting_limit = 0,
        };
    }

    pub fn fromPointer(
        segments: []Segment,
        seg_idx: u32,
        ptr_in: Pointer,
        ptr_word: u32,
        depth: i32,
    ) ListReader {
        if (ptr_in.isNull()) return empty();
        var ptr = ptr_in;
        var cur_seg = seg_idx;
        var base_word: i64 = @as(i64, ptr_word) + 1;

        if (ptr.kind() == .far) {
            const target_seg = ptr.farSegment();
            if (target_seg >= segments.len) return empty();
            const land_off = ptr.farOffset();
            const seg = segments[target_seg];
            if (ptr.farIsDouble()) {
                if (land_off + 2 > seg.words()) return empty();
                const land = seg.readPtr(land_off);
                const tag = seg.readPtr(land_off + 1);
                cur_seg = land.farSegment();
                base_word = land.farOffset();
                ptr = tag;
            } else {
                if (land_off >= seg.words()) return empty();
                ptr = seg.readPtr(land_off);
                cur_seg = target_seg;
                base_word = @as(i64, land_off) + 1;
            }
        }

        if (ptr.kind() != .list) return empty();

        const target = base_word + @as(i64, ptr.offset());
        if (target < 0) return empty();
        const tw: u32 = @intCast(target);
        const elem = ptr.listElemSize();
        const count_or_words = ptr.listElemCount();
        const seg = segments[cur_seg];

        if (elem == .composite) {
            if (@as(usize, tw) + count_or_words + 1 > seg.words()) return empty();
            const tag = seg.readPtr(tw);
            const elem_count = @as(u32, @bitCast(tag.offset())) & 0x3FFF_FFFF;
            const dw = tag.structDataSize();
            const pw = tag.structPtrSize();
            const total_per = @as(u32, dw) + @as(u32, pw);
            if (total_per != 0 and elem_count > count_or_words / total_per) return empty();
            return .{
                .segments = segments,
                .segment_idx = cur_seg,
                .data_word = tw + 1,
                .elem_data_words = dw,
                .elem_ptr_words = pw,
                .step_bits = total_per * 64,
                .elem_size = .composite,
                .count = elem_count,
                .nesting_limit = depth - 1,
            };
        }

        const bits_per: u32 = switch (elem) {
            .void_ => 0,
            .bit => 1,
            .byte => 8,
            .two_bytes => 16,
            .four_bytes => 32,
            .eight_bytes => 64,
            .pointer => 64,
            .composite => unreachable,
        };
        const total_bits: u64 = @as(u64, count_or_words) * bits_per;
        const total_words: u64 = (total_bits + 63) / 64;
        if (@as(u64, tw) + total_words > seg.words()) return empty();

        return .{
            .segments = segments,
            .segment_idx = cur_seg,
            .data_word = tw,
            .step_bits = bits_per,
            .elem_size = elem,
            .count = count_or_words,
            .nesting_limit = depth - 1,
        };
    }

    pub fn getU8(self: ListReader, i: u32) u8 {
        if (i >= self.count) return 0;
        const seg = self.segments[self.segment_idx];
        const bit = i * self.step_bits;
        const byte = bit / 8;
        const word = self.data_word + byte / word_size;
        return seg.data(word, byte % word_size, u8);
    }

    pub fn getU16(self: ListReader, i: u32) u16 {
        if (i >= self.count) return 0;
        const seg = self.segments[self.segment_idx];
        const byte = (i * self.step_bits) / 8;
        const word = self.data_word + byte / word_size;
        return seg.data(word, byte % word_size, u16);
    }

    pub fn getU32(self: ListReader, i: u32) u32 {
        if (i >= self.count) return 0;
        const seg = self.segments[self.segment_idx];
        const byte = (i * self.step_bits) / 8;
        const word = self.data_word + byte / word_size;
        return seg.data(word, byte % word_size, u32);
    }

    pub fn getU64(self: ListReader, i: u32) u64 {
        if (i >= self.count) return 0;
        const seg = self.segments[self.segment_idx];
        const byte = (i * self.step_bits) / 8;
        const word = self.data_word + byte / word_size;
        return seg.data(word, byte % word_size, u64);
    }

    pub fn getStruct(self: ListReader, i: u32) StructReader {
        if (i >= self.count or self.nesting_limit <= 0) return StructReader.empty();
        if (self.elem_size == .composite) {
            const off_words = (i * self.step_bits) / 64;
            return .{
                .segments = self.segments,
                .segment_idx = self.segment_idx,
                .data_word = self.data_word + off_words,
                .data_words = self.elem_data_words,
                .ptr_words = self.elem_ptr_words,
                .nesting_limit = self.nesting_limit - 1,
            };
        }
        // Lists of primitives may be decoded as struct lists per the encoding spec.
        const off_bits = i * self.step_bits;
        const data_bytes = self.step_bits / 8;
        return .{
            .segments = self.segments,
            .segment_idx = self.segment_idx,
            .data_word = self.data_word + off_bits / 64,
            .data_words = if (data_bytes >= 8) 1 else 0,
            .ptr_words = if (self.elem_size == .pointer) 1 else 0,
            .nesting_limit = self.nesting_limit - 1,
        };
    }
};

/// Build messages into one or more growable segments.
pub const MessageBuilder = struct {
    allocator: std.mem.Allocator,
    segments: std.ArrayList(SegmentBuilder),

    pub fn init(allocator: std.mem.Allocator, initial_words: u32) !MessageBuilder {
        var mb: MessageBuilder = .{
            .allocator = allocator,
            .segments = .empty,
        };
        try mb.addSegment(initial_words);
        // Reserve word 0 of segment 0 for the root pointer.
        _ = mb.segments.items[0].alloc(1);
        return mb;
    }

    pub fn deinit(self: *MessageBuilder) void {
        for (self.segments.items) |*s| s.deinit(self.allocator);
        self.segments.deinit(self.allocator);
    }

    fn addSegment(self: *MessageBuilder, words: u32) !void {
        const cap = @max(words, 64);
        const buf = try self.allocator.alignedAlloc(u8, .@"8", cap * word_size);
        @memset(buf, 0);
        try self.segments.append(self.allocator, .{
            .bytes = buf,
            .used = 0,
        });
    }

    pub fn allocate(self: *MessageBuilder, words: u32) !Allocation {
        if (self.segments.items.len > 0) {
            const last_idx = self.segments.items.len - 1;
            if (self.segments.items[last_idx].canFit(words)) {
                const off = self.segments.items[last_idx].alloc(words);
                return .{ .segment_idx = @intCast(last_idx), .word_offset = off };
            }
        }
        try self.addSegment(words);
        const last_idx = self.segments.items.len - 1;
        const off = self.segments.items[last_idx].alloc(words);
        return .{ .segment_idx = @intCast(last_idx), .word_offset = off };
    }

    pub fn initRoot(self: *MessageBuilder, data_words: u16, ptr_words: u16) !StructBuilder {
        const total = @as(u32, data_words) + ptr_words;
        const allocation = try self.allocate(total);
        const seg = self.segmentBytesMut(0);
        if (allocation.segment_idx == 0) {
            const root_ptr = Pointer.makeStruct(
                @as(i32, @intCast(allocation.word_offset)) - 1,
                data_words,
                ptr_words,
            );
            std.mem.writeInt(u64, seg[0..8], root_ptr.raw, .little);
        } else {
            const far = Pointer.makeFar(false, allocation.word_offset, allocation.segment_idx);
            std.mem.writeInt(u64, seg[0..8], far.raw, .little);
        }
        return .{
            .builder = self,
            .segment_idx = allocation.segment_idx,
            .data_word = allocation.word_offset,
            .data_words = data_words,
            .ptr_words = ptr_words,
        };
    }

    pub fn segmentBytesMut(self: *MessageBuilder, idx: u32) []u8 {
        return self.segments.items[idx].bytes;
    }

    /// Encode message in the standard stream-framed format. Caller owns the slice.
    pub fn toBytes(self: *MessageBuilder, allocator: std.mem.Allocator) ![]u8 {
        const total = self.framedSize();
        const out = try allocator.alloc(u8, total);
        _ = self.toBytesInto(out);
        return out;
    }

    /// Total size required by `toBytesInto`.
    pub fn framedSize(self: *MessageBuilder) usize {
        const seg_count: u32 = @intCast(self.segments.items.len);
        const header_unpadded: u32 = 4 + 4 * seg_count;
        const header_padded: u32 = (header_unpadded + 7) & ~@as(u32, 7);
        var total: u64 = header_padded;
        for (self.segments.items) |s| total += @as(u64, s.used) * word_size;
        return @intCast(total);
    }

    /// Write framed bytes directly into `out`. Caller must size `out` to
    /// `framedSize()`. Returns the number of bytes written.
    pub fn toBytesInto(self: *MessageBuilder, out: []u8) usize {
        const seg_count: u32 = @intCast(self.segments.items.len);
        const header_unpadded: u32 = 4 + 4 * seg_count;
        const header_padded: u32 = (header_unpadded + 7) & ~@as(u32, 7);

        std.mem.writeInt(u32, out[0..4], seg_count - 1, .little);
        for (self.segments.items, 0..) |s, i| {
            const off = 4 + 4 * i;
            std.mem.writeInt(u32, out[off..][0..4], s.used, .little);
        }
        // Zero any header padding bytes between the size table and segment 0.
        if (header_padded > header_unpadded) {
            @memset(out[header_unpadded..header_padded], 0);
        }
        var cursor: usize = header_padded;
        for (self.segments.items) |s| {
            const len = s.used * word_size;
            @memcpy(out[cursor .. cursor + len], s.bytes[0..len]);
            cursor += len;
        }
        return cursor;
    }
};

pub const Allocation = struct {
    segment_idx: u32,
    word_offset: u32,
};

pub const SegmentBuilder = struct {
    bytes: []align(8) u8,
    used: u32,

    pub fn deinit(self: *SegmentBuilder, allocator: std.mem.Allocator) void {
        allocator.free(self.bytes);
    }

    pub fn canFit(self: SegmentBuilder, words: u32) bool {
        return @as(u64, self.used) + words <= self.bytes.len / word_size;
    }

    pub fn alloc(self: *SegmentBuilder, words: u32) u32 {
        const off = self.used;
        self.used += words;
        return off;
    }
};

pub const StructBuilder = struct {
    builder: *MessageBuilder,
    segment_idx: u32,
    data_word: u32,
    data_words: u16,
    ptr_words: u16,

    fn segBytes(self: StructBuilder) []u8 {
        return self.builder.segments.items[self.segment_idx].bytes;
    }

    pub fn setU8(self: StructBuilder, byte_off: u32, value: u8) void {
        const off = self.data_word * word_size + byte_off;
        self.segBytes()[off] = value;
    }

    pub fn setU16(self: StructBuilder, byte_off: u32, value: u16) void {
        const off = self.data_word * word_size + byte_off;
        std.mem.writeInt(u16, self.segBytes()[off..][0..2], value, .little);
    }

    pub fn setU32(self: StructBuilder, byte_off: u32, value: u32) void {
        const off = self.data_word * word_size + byte_off;
        std.mem.writeInt(u32, self.segBytes()[off..][0..4], value, .little);
    }

    pub fn setU64(self: StructBuilder, byte_off: u32, value: u64) void {
        const off = self.data_word * word_size + byte_off;
        std.mem.writeInt(u64, self.segBytes()[off..][0..8], value, .little);
    }

    pub fn setBool(self: StructBuilder, bit_off: u32, value: bool) void {
        const byte = bit_off / 8;
        const bit: u3 = @truncate(bit_off % 8);
        const off = self.data_word * word_size + byte;
        const seg = self.segBytes();
        const mask: u8 = @as(u8, 1) << bit;
        if (value) seg[off] |= mask else seg[off] &= ~mask;
    }

    pub fn initStruct(self: StructBuilder, ptr_idx: u16, data_words: u16, ptr_words: u16) !StructBuilder {
        const total = @as(u32, data_words) + ptr_words;
        const allocation = try self.builder.allocate(total);
        try self.writePointerSlot(ptr_idx, allocation, .{ .struct_kind = .{ .data_words = data_words, .ptr_words = ptr_words } });
        return .{
            .builder = self.builder,
            .segment_idx = allocation.segment_idx,
            .data_word = allocation.word_offset,
            .data_words = data_words,
            .ptr_words = ptr_words,
        };
    }

    const PointerKindArgs = union(enum) {
        struct_kind: struct { data_words: u16, ptr_words: u16 },
        list_prim_kind: struct { elem: ElementSize, count: u32 },
        list_composite_kind: struct { word_count: u32 },
    };

    fn writePointerSlot(
        self: StructBuilder,
        ptr_idx: u16,
        allocation: Allocation,
        args: PointerKindArgs,
    ) !void {
        const ptr_word = self.data_word + self.data_words + ptr_idx;
        const seg = self.segBytes();
        if (allocation.segment_idx == self.segment_idx) {
            const off: i64 = @as(i64, allocation.word_offset) - (@as(i64, ptr_word) + 1);
            const ptr = switch (args) {
                .struct_kind => |s| Pointer.makeStruct(@intCast(off), s.data_words, s.ptr_words),
                .list_prim_kind => |l| Pointer.makeList(@intCast(off), l.elem, l.count),
                .list_composite_kind => |l| Pointer.makeList(@intCast(off), .composite, l.word_count),
            };
            std.mem.writeInt(u64, seg[ptr_word * word_size ..][0..8], ptr.raw, .little);
        } else {
            const pad = try self.builder.allocate(2);
            const pad_seg_bytes = self.builder.segments.items[pad.segment_idx].bytes;
            const land1 = Pointer.makeFar(false, allocation.word_offset, allocation.segment_idx);
            std.mem.writeInt(u64, pad_seg_bytes[pad.word_offset * word_size ..][0..8], land1.raw, .little);
            const tag = switch (args) {
                .struct_kind => |s| Pointer.makeStruct(0, s.data_words, s.ptr_words),
                .list_prim_kind => |l| Pointer.makeList(0, l.elem, l.count),
                .list_composite_kind => |l| Pointer.makeList(0, .composite, l.word_count),
            };
            std.mem.writeInt(u64, pad_seg_bytes[(pad.word_offset + 1) * word_size ..][0..8], tag.raw, .little);
            const far = Pointer.makeFar(true, pad.word_offset, pad.segment_idx);
            std.mem.writeInt(u64, seg[ptr_word * word_size ..][0..8], far.raw, .little);
        }
    }

    pub fn initListPrim(self: StructBuilder, ptr_idx: u16, elem: ElementSize, count: u32) !ListBuilder {
        const bits_per: u32 = switch (elem) {
            .void_ => 0,
            .bit => 1,
            .byte => 8,
            .two_bytes => 16,
            .four_bytes => 32,
            .eight_bytes => 64,
            .pointer => 64,
            .composite => return error.UseInitListComposite,
        };
        const total_bits: u64 = @as(u64, count) * bits_per;
        const total_words: u32 = @intCast((total_bits + 63) / 64);
        const allocation = try self.builder.allocate(total_words);
        try self.writePointerSlot(ptr_idx, allocation, .{ .list_prim_kind = .{ .elem = elem, .count = count } });
        return .{
            .builder = self.builder,
            .segment_idx = allocation.segment_idx,
            .data_word = allocation.word_offset,
            .step_bits = bits_per,
            .elem_size = elem,
            .count = count,
            .elem_data_words = 0,
            .elem_ptr_words = 0,
        };
    }

    pub fn setText(self: StructBuilder, ptr_idx: u16, text: []const u8) !void {
        const lb = try self.initListPrim(ptr_idx, .byte, @intCast(text.len + 1));
        const seg = self.builder.segments.items[lb.segment_idx].bytes;
        @memcpy(seg[lb.data_word * word_size ..][0..text.len], text);
    }

    pub fn setData(self: StructBuilder, ptr_idx: u16, bytes: []const u8) !void {
        const lb = try self.initListPrim(ptr_idx, .byte, @intCast(bytes.len));
        const seg = self.builder.segments.items[lb.segment_idx].bytes;
        @memcpy(seg[lb.data_word * word_size ..][0..bytes.len], bytes);
    }

    pub fn initListComposite(
        self: StructBuilder,
        ptr_idx: u16,
        count: u32,
        elem_data_words: u16,
        elem_ptr_words: u16,
    ) !ListBuilder {
        const per: u32 = @as(u32, elem_data_words) + elem_ptr_words;
        const data_words: u32 = per * count;
        const allocation = try self.builder.allocate(data_words + 1);
        const seg_bytes = self.builder.segments.items[allocation.segment_idx].bytes;
        const tag = Pointer.makeStruct(@intCast(count), elem_data_words, elem_ptr_words);
        std.mem.writeInt(u64, seg_bytes[allocation.word_offset * word_size ..][0..8], tag.raw, .little);
        // The list pointer points one past the tag (where elements begin).
        // We compute the list-pointer offset as if the list started at allocation.word_offset
        // (the tag), per the wire format: a composite list pointer points to its tag word.
        try self.writePointerSlot(ptr_idx, allocation, .{ .list_composite_kind = .{ .word_count = data_words } });
        return .{
            .builder = self.builder,
            .segment_idx = allocation.segment_idx,
            .data_word = allocation.word_offset + 1,
            .step_bits = per * 64,
            .elem_size = .composite,
            .count = count,
            .elem_data_words = elem_data_words,
            .elem_ptr_words = elem_ptr_words,
        };
    }
};

pub const ListBuilder = struct {
    builder: *MessageBuilder,
    segment_idx: u32,
    data_word: u32,
    step_bits: u32,
    elem_size: ElementSize,
    count: u32,
    elem_data_words: u16,
    elem_ptr_words: u16,

    fn segBytes(self: ListBuilder) []u8 {
        return self.builder.segments.items[self.segment_idx].bytes;
    }

    pub fn setU8(self: ListBuilder, i: u32, v: u8) void {
        const off = self.data_word * word_size + (i * self.step_bits) / 8;
        self.segBytes()[off] = v;
    }

    pub fn setU16(self: ListBuilder, i: u32, v: u16) void {
        const off = self.data_word * word_size + (i * self.step_bits) / 8;
        std.mem.writeInt(u16, self.segBytes()[off..][0..2], v, .little);
    }

    pub fn setU32(self: ListBuilder, i: u32, v: u32) void {
        const off = self.data_word * word_size + (i * self.step_bits) / 8;
        std.mem.writeInt(u32, self.segBytes()[off..][0..4], v, .little);
    }

    pub fn setU64(self: ListBuilder, i: u32, v: u64) void {
        const off = self.data_word * word_size + (i * self.step_bits) / 8;
        std.mem.writeInt(u64, self.segBytes()[off..][0..8], v, .little);
    }

    pub fn getStruct(self: ListBuilder, i: u32) StructBuilder {
        const per_words = self.step_bits / 64;
        return .{
            .builder = self.builder,
            .segment_idx = self.segment_idx,
            .data_word = self.data_word + i * per_words,
            .data_words = self.elem_data_words,
            .ptr_words = self.elem_ptr_words,
        };
    }
};

/// Parse a stream-framed Cap'n Proto message into segments.
pub const ParsedMessage = struct {
    segments: []Segment,
    bytes_owned: []align(8) u8,
    seg_alloc: std.mem.Allocator,

    pub fn deinit(self: *ParsedMessage) void {
        self.seg_alloc.free(self.segments);
        if (self.bytes_owned.len > 0) self.seg_alloc.free(self.bytes_owned);
    }

    pub fn root(self: *const ParsedMessage) StructReader {
        if (self.segments.len == 0 or self.segments[0].words() == 0) return StructReader.empty();
        return StructReader.fromPointer(self.segments, 0, self.segments[0].readPtr(0), 0);
    }
};

pub fn parseStreamFramed(allocator: std.mem.Allocator, bytes: []const u8) !ParsedMessage {
    if (bytes.len < 4) return error.MessageTooShort;
    const seg_count_minus_one = std.mem.readInt(u32, bytes[0..4], .little);
    if (seg_count_minus_one == 0xFFFFFFFF) return error.InvalidSegmentCount;
    const seg_count: u32 = seg_count_minus_one + 1;
    if (seg_count > max_segments) return error.TooManySegments;

    const header_unpadded: u32 = 4 + 4 * seg_count;
    const header_padded: u32 = (header_unpadded + 7) & ~@as(u32, 7);
    if (bytes.len < header_padded) return error.MessageTooShort;

    const segs = try allocator.alloc(Segment, seg_count);
    errdefer allocator.free(segs);

    var total_words: u64 = 0;
    var i: u32 = 0;
    while (i < seg_count) : (i += 1) {
        const off = 4 + 4 * i;
        const sw = std.mem.readInt(u32, bytes[off..][0..4], .little);
        if (sw > max_segment_words) return error.SegmentTooLarge;
        total_words += sw;
    }
    const total_bytes: usize = @intCast(total_words * word_size);
    if (bytes.len < @as(usize, header_padded) + total_bytes) return error.MessageTooShort;

    const owned = try allocator.alignedAlloc(u8, .@"8", total_bytes);
    errdefer allocator.free(owned);
    @memcpy(owned, bytes[header_padded .. header_padded + total_bytes]);

    var cursor: usize = 0;
    i = 0;
    while (i < seg_count) : (i += 1) {
        const off = 4 + 4 * i;
        const sw = std.mem.readInt(u32, bytes[off..][0..4], .little);
        const len = @as(usize, sw) * word_size;
        const slice_unaligned = owned[cursor .. cursor + len];
        // The whole `owned` buffer is 8-aligned, and each segment starts at a
        // multiple-of-8 offset, so each sub-slice is also 8-aligned.
        segs[i] = .{ .bytes = @alignCast(slice_unaligned) };
        cursor += len;
    }

    return .{ .segments = segs, .bytes_owned = owned, .seg_alloc = allocator };
}

/// Zero-copy variant: borrows the input bytes directly. Caller must guarantee
/// the input is 8-aligned and remains valid for the lifetime of the returned
/// message. Returned ParsedMessage's `bytes_owned` is empty so deinit only
/// frees the segments array.
pub fn parseStreamFramedBorrowed(allocator: std.mem.Allocator, bytes: []align(8) const u8) !ParsedMessage {
    if (bytes.len < 4) return error.MessageTooShort;
    const seg_count_minus_one = std.mem.readInt(u32, bytes[0..4], .little);
    if (seg_count_minus_one == 0xFFFFFFFF) return error.InvalidSegmentCount;
    const seg_count: u32 = seg_count_minus_one + 1;
    if (seg_count > max_segments) return error.TooManySegments;

    const header_unpadded: u32 = 4 + 4 * seg_count;
    const header_padded: u32 = (header_unpadded + 7) & ~@as(u32, 7);
    if (bytes.len < header_padded) return error.MessageTooShort;

    const segs = try allocator.alloc(Segment, seg_count);
    errdefer allocator.free(segs);

    var cursor: usize = header_padded;
    var i: u32 = 0;
    while (i < seg_count) : (i += 1) {
        const off = 4 + 4 * i;
        const sw = std.mem.readInt(u32, bytes[off..][0..4], .little);
        if (sw > max_segment_words) return error.SegmentTooLarge;
        const len = @as(usize, sw) * word_size;
        if (cursor + len > bytes.len) return error.MessageTooShort;
        // Slice into the borrowed buffer; alignment preserved because
        // `bytes` is 8-aligned and `cursor` is at a word boundary.
        const slice_const: []const u8 = bytes[cursor .. cursor + len];
        // The Segment owns []u8 (mutable slice) for the writer paths; here
        // we reuse Segment for read-only access via @constCast, valid because
        // we never mutate through these segments in the lazy reader.
        const slice_mut = @constCast(slice_const);
        segs[i] = .{ .bytes = @alignCast(slice_mut) };
        cursor += len;
    }

    // Return a parsed message with no owned buffer; deinit frees only segs.
    return .{
        .segments = segs,
        .bytes_owned = &[_]u8{},
        .seg_alloc = allocator,
    };
}
