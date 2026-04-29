// WASM entry: linear-memory exports for the JS glue layer.
//
// Memory model: a single shared linear memory is used for all encode/decode
// operations. JS stages inbound bytes at `cw_in_ptr` and reads outbound bytes
// at `cw_out_ptr`; both are static regions of fixed capacity. A 2 MB bump
// arena backs MessageBuilder allocations during a single encode/decode call
// and is reset between calls so allocation is O(1).
//
// All exported functions follow C ABI (extern "C"). Pointers are u32 offsets
// into linear memory.

const std = @import("std");
const wire = @import("wire.zig");
const rpc = @import("rpc.zig");
const tape = @import("tape.zig");
const json_emit = @import("json_emit.zig");

// ---------------------------------------------------------------------------
// Allocator (used for the rare paths that need real heap; the hot path uses
// the static codec arena below).
// ---------------------------------------------------------------------------

const wasm_alloc = std.heap.wasm_allocator;

// ---------------------------------------------------------------------------
// Session lifecycle (single global slot — capnwasm sessions are 1-per-process
// at the wasm level; multi-session JS callers can keep multiple wasm modules
// or extend this to an array later).
// ---------------------------------------------------------------------------

var session_slot: ?*rpc.Session = null;

export fn cw_session_create() u32 {
    if (session_slot != null) return 1;
    const session = wasm_alloc.create(rpc.Session) catch return 0;
    session.* = rpc.Session.init(wasm_alloc);
    session_slot = session;
    return 1;
}

export fn cw_session_destroy(_: u32) void {
    if (session_slot) |s| {
        s.deinit();
        wasm_alloc.destroy(s);
        session_slot = null;
    }
}

export fn cw_session_alloc_import(_: u32) i64 {
    const s = session_slot orelse return 0;
    return s.allocateImportId() catch 0;
}

export fn cw_session_alloc_export(_: u32, target: u64) i64 {
    const s = session_slot orelse return 0;
    return s.allocateExportId(target) catch 0;
}

export fn cw_session_release_import(_: u32, id: i64, refcount: u32) void {
    const s = session_slot orelse return;
    s.releaseImport(id, refcount);
}

// ---------------------------------------------------------------------------
// Scratch buffers and codec arena
// ---------------------------------------------------------------------------

const SCRATCH_IN_CAP: usize = 256 * 1024;
const SCRATCH_OUT_CAP: usize = 256 * 1024;

var scratch_in: [SCRATCH_IN_CAP]u8 align(8) = undefined;
var scratch_out: [SCRATCH_OUT_CAP]u8 align(8) = undefined;

export fn cw_in_ptr() [*]u8 {
    return @ptrCast(&scratch_in);
}

export fn cw_in_capacity() u32 {
    return SCRATCH_IN_CAP;
}

export fn cw_out_ptr() [*]u8 {
    return @ptrCast(&scratch_out);
}

export fn cw_out_capacity() u32 {
    return SCRATCH_OUT_CAP;
}

const CODEC_ARENA_SIZE: usize = 2 * 1024 * 1024;
var codec_arena_buf: [CODEC_ARENA_SIZE]u8 align(8) = undefined;
var codec_fba: std.heap.FixedBufferAllocator = .{ .end_index = 0, .buffer = &codec_arena_buf };

inline fn codecAllocator() std.mem.Allocator {
    codec_fba.reset();
    return codec_fba.allocator();
}

// ---------------------------------------------------------------------------
// Fixed-format encoders for trivial RPC messages
// ---------------------------------------------------------------------------

export fn cw_encode_pull(import_id: i64) u32 {
    var out: []u8 = scratch_out[0..];
    std.mem.writeInt(u32, out[0..4], 0, .little);
    std.mem.writeInt(u32, out[4..8], 3, .little);
    const root = wire.Pointer.makeStruct(0, 2, 0);
    std.mem.writeInt(u64, out[8..16], root.raw, .little);
    @memset(out[16..24], 0);
    std.mem.writeInt(u16, out[16..18], @intFromEnum(rpc.MessageTag.pull), .little);
    std.mem.writeInt(i64, out[24..32], import_id, .little);
    return 32;
}

export fn cw_encode_release(import_id: i64, refcount: u32) u32 {
    var out: []u8 = scratch_out[0..];
    std.mem.writeInt(u32, out[0..4], 0, .little);
    std.mem.writeInt(u32, out[4..8], 4, .little);
    const root = wire.Pointer.makeStruct(0, 3, 0);
    std.mem.writeInt(u64, out[8..16], root.raw, .little);
    @memset(out[16..40], 0);
    std.mem.writeInt(u16, out[16..18], @intFromEnum(rpc.MessageTag.release), .little);
    std.mem.writeInt(i64, out[24..32], import_id, .little);
    std.mem.writeInt(u32, out[32..36], refcount, .little);
    return 40;
}

// ---------------------------------------------------------------------------
// Tape-driven encode/decode
// ---------------------------------------------------------------------------

/// Encode a tape (in scratch_in[0..tape_len]) into Cap'n Proto bytes
/// (written into scratch_out). Returns the encoded byte count, or 0 on error.
export fn cw_encode_tape(tape_len: u32) u32 {
    const allocator = codecAllocator();
    const tape_bytes = scratch_in[0..tape_len];
    const written = tape.encodeTapeInto(allocator, tape_bytes, scratch_out[0..]) catch return 0;
    return @intCast(written);
}

/// Decode Cap'n Proto bytes (in scratch_in[0..len]) into a tape (written to
/// scratch_out). Returns the tape byte count, or 0 on error.
export fn cw_decode_to_tape(len: u32) u32 {
    const allocator = codecAllocator();
    const tape_len = tape.decodeMessage(allocator, scratch_in[0..len], scratch_out[0..]) catch return 0;
    return @intCast(tape_len);
}

/// Decode Cap'n Proto bytes into JSON text (capnweb-shape) for direct
/// JSON.parse on the JS side.
export fn cw_decode_to_json(len: u32) u32 {
    const allocator = codecAllocator();
    const written = json_emit.decodeToJson(allocator, scratch_in[0..len], scratch_out[0..]) catch return 0;
    return @intCast(written);
}

/// Probe for E_DATA payloads of >= `min_bytes` bytes at the top level. Used
/// by JS to switch between the JSON and tape decode paths.
export fn cw_has_large_data(len: u32, min_bytes: u32) i32 {
    const allocator = codecAllocator();
    var parsed = wire.parseStreamFramed(allocator, scratch_in[0..len]) catch return -1;
    defer parsed.deinit();
    const root = parsed.root();
    const tag = rpc.readMessageTag(root);
    const expr = switch (tag) {
        .push, .resolve, .reject, .stream, .abort => rpc.readExpression(root),
        else => return 0,
    };
    if (isLargeDataExpr(expr, min_bytes)) return 1;
    const expr_tag: u8 = @truncate(expr.readU16(0, 0));
    if (@as(tape.ExprTag, @enumFromInt(expr_tag)) == .pipeline) {
        const args_ptr = expr.readPointerAt(3);
        if (!args_ptr.isNull() and isLargeDataExpr(expr.readStruct(3), min_bytes)) return 1;
    }
    return 0;
}

inline fn isLargeDataExpr(reader: wire.StructReader, min_bytes: u32) bool {
    const tag_byte: u8 = @truncate(reader.readU16(0, 0));
    const tag: tape.ExprTag = @enumFromInt(tag_byte);
    return tag == .data and reader.readList(0).count >= min_bytes;
}

// ---------------------------------------------------------------------------
// Version probe
// ---------------------------------------------------------------------------

export fn cw_abi_version() u32 {
    return 4;
}
