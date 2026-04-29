// WASM entry: linear-memory exports for the JS glue layer.
//
// Memory model: a single shared linear memory is used for all builders and
// readers. The host JS calls `cw_alloc(n)` to obtain a buffer for inbound
// bytes, then `cw_parse_message(ptr, len)` returning a session-local handle
// for the resulting reader. The host calls `cw_session_create()` to obtain
// a session handle and uses session-bound functions for RPC bookkeeping.
//
// All exported functions follow C ABI (extern "C"). Pointers are u32 offsets
// into linear memory.

const std = @import("std");
const wire = @import("wire.zig");
const rpc = @import("rpc.zig");
const packing = @import("packing.zig");
const tape = @import("tape.zig");

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/// Linear-memory allocator backed by `@wasmMemoryGrow`. JS calls `cw_alloc` /
/// `cw_free` for inbound buffers; the runtime uses the same allocator for
/// internal allocations so all freed memory ends up on a single freelist.
const wasm_alloc = std.heap.wasm_allocator;

export fn cw_alloc(n: u32) ?[*]u8 {
    const buf = wasm_alloc.alloc(u8, n) catch return null;
    return buf.ptr;
}

export fn cw_free(ptr: [*]u8, n: u32) void {
    wasm_alloc.free(ptr[0..n]);
}

// ---------------------------------------------------------------------------
// Handle tables
// ---------------------------------------------------------------------------

const HandleKind = enum(u8) {
    session = 1,
    builder = 2,
    parsed = 3,
    bytes = 4,
};

const Handle = struct {
    kind: HandleKind,
    ptr: usize,
    extra: usize = 0,
};

var handle_table: std.AutoHashMapUnmanaged(u32, Handle) = .{};
var next_handle: u32 = 1;

fn registerHandle(kind: HandleKind, ptr: usize, extra: usize) u32 {
    const id = next_handle;
    next_handle += 1;
    handle_table.put(wasm_alloc, id, .{ .kind = kind, .ptr = ptr, .extra = extra }) catch return 0;
    return id;
}

fn getHandle(id: u32, want: HandleKind) ?Handle {
    const h = handle_table.get(id) orelse return null;
    if (h.kind != want) return null;
    return h;
}

fn dropHandleTyped(id: u32, want: HandleKind) ?Handle {
    const kv = handle_table.fetchRemove(id) orelse return null;
    if (kv.value.kind != want) {
        // Restore: we removed the wrong-kind handle by accident.
        handle_table.put(wasm_alloc, id, kv.value) catch {};
        return null;
    }
    return kv.value;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export fn cw_session_create() u32 {
    const session = wasm_alloc.create(rpc.Session) catch return 0;
    session.* = rpc.Session.init(wasm_alloc);
    return registerHandle(.session, @intFromPtr(session), 0);
}

export fn cw_session_destroy(id: u32) void {
    const h = dropHandleTyped(id, .session) orelse return;
    const s: *rpc.Session = @ptrFromInt(h.ptr);
    s.deinit();
    wasm_alloc.destroy(s);
}

export fn cw_session_alloc_import(session: u32) i64 {
    const h = getHandle(session, .session) orelse return 0;
    const s: *rpc.Session = @ptrFromInt(h.ptr);
    return s.allocateImportId() catch 0;
}

export fn cw_session_alloc_export(session: u32, target: u64) i64 {
    const h = getHandle(session, .session) orelse return 0;
    const s: *rpc.Session = @ptrFromInt(h.ptr);
    return s.allocateExportId(target) catch 0;
}

export fn cw_session_release_import(session: u32, id: i64, refcount: u32) void {
    const h = getHandle(session, .session) orelse return;
    const s: *rpc.Session = @ptrFromInt(h.ptr);
    s.releaseImport(id, refcount);
}

// ---------------------------------------------------------------------------
// Message parsing (inbound)
// ---------------------------------------------------------------------------

const Parsed = struct {
    msg: wire.ParsedMessage,
};

export fn cw_parse_message(ptr: [*]const u8, len: u32) u32 {
    const bytes = ptr[0..len];
    const parsed = wire.parseStreamFramed(wasm_alloc, bytes) catch return 0;
    const p = wasm_alloc.create(Parsed) catch return 0;
    p.* = .{ .msg = parsed };
    return registerHandle(.parsed, @intFromPtr(p), 0);
}

export fn cw_parsed_destroy(id: u32) void {
    const h = dropHandleTyped(id, .parsed) orelse return;
    const p: *Parsed = @ptrFromInt(h.ptr);
    p.msg.deinit();
    wasm_alloc.destroy(p);
}

export fn cw_parsed_message_tag(id: u32) i32 {
    const h = getHandle(id, .parsed) orelse return -1;
    const p: *Parsed = @ptrFromInt(h.ptr);
    return @intFromEnum(rpc.readMessageTag(p.msg.root()));
}

export fn cw_parsed_pull_id(id: u32) i64 {
    const h = getHandle(id, .parsed) orelse return 0;
    const p: *Parsed = @ptrFromInt(h.ptr);
    return rpc.readPullId(p.msg.root());
}

export fn cw_parsed_resolve_id(id: u32) i64 {
    const h = getHandle(id, .parsed) orelse return 0;
    const p: *Parsed = @ptrFromInt(h.ptr);
    return rpc.readResolveOrRejectId(p.msg.root());
}

export fn cw_parsed_release_refcount(id: u32) u32 {
    const h = getHandle(id, .parsed) orelse return 0;
    const p: *Parsed = @ptrFromInt(h.ptr);
    return rpc.readReleaseRefcount(p.msg.root());
}

// ---------------------------------------------------------------------------
// Message building (outbound)
// ---------------------------------------------------------------------------

const BuilderHandle = struct {
    builder: wire.MessageBuilder,
    /// Optional saved root struct view for the JS layer to drive.
    root_data_word: u32 = 0,
    root_data_words: u16 = 0,
    root_ptr_words: u16 = 0,
    root_segment: u32 = 0,
};

export fn cw_builder_create(initial_words: u32) u32 {
    const bh = wasm_alloc.create(BuilderHandle) catch return 0;
    bh.* = .{
        .builder = wire.MessageBuilder.init(wasm_alloc, initial_words) catch {
            wasm_alloc.destroy(bh);
            return 0;
        },
    };
    return registerHandle(.builder, @intFromPtr(bh), 0);
}

export fn cw_builder_destroy(id: u32) void {
    const h = dropHandleTyped(id, .builder) orelse return;
    const bh: *BuilderHandle = @ptrFromInt(h.ptr);
    bh.builder.deinit();
    wasm_alloc.destroy(bh);
}

export fn cw_build_pull_message(builder_id: u32, import_id: i64) i32 {
    const h = getHandle(builder_id, .builder) orelse return -1;
    const bh: *BuilderHandle = @ptrFromInt(h.ptr);
    rpc.buildPullMessage(&bh.builder, import_id) catch return -1;
    return 0;
}

export fn cw_build_release_message(builder_id: u32, import_id: i64, refcount: u32) i32 {
    const h = getHandle(builder_id, .builder) orelse return -1;
    const bh: *BuilderHandle = @ptrFromInt(h.ptr);
    rpc.buildReleaseMessage(&bh.builder, import_id, refcount) catch return -1;
    return 0;
}

/// Builds a push message whose expression is a single `text` literal.
/// Used by JS to send simple string-based test calls and to bootstrap the
/// expression-tree encoder. The full expression tree is built in JS via
/// dedicated builder ops once the Proxy layer is wired up.
export fn cw_build_push_text(builder_id: u32, text_ptr: [*]const u8, text_len: u32) i32 {
    const h = getHandle(builder_id, .builder) orelse return -1;
    const bh: *BuilderHandle = @ptrFromInt(h.ptr);
    const built = rpc.buildPushMessage(&bh.builder, 2, 1) catch return -1;
    rpc.buildTextExpression(built.expr, text_ptr[0..text_len]) catch return -1;
    return 0;
}

/// Serialize the current builder's message to stream-framed bytes.
/// Returns a handle to a (ptr, len) pair stored in the handle table.
/// Use cw_bytes_ptr / cw_bytes_len / cw_bytes_destroy from JS.
export fn cw_builder_to_bytes(builder_id: u32) u32 {
    const h = getHandle(builder_id, .builder) orelse return 0;
    const bh: *BuilderHandle = @ptrFromInt(h.ptr);
    const out = bh.builder.toBytes(wasm_alloc) catch return 0;
    return registerHandle(.bytes, @intFromPtr(out.ptr), out.len);
}

export fn cw_bytes_ptr(id: u32) ?[*]u8 {
    const h = getHandle(id, .bytes) orelse return null;
    return @ptrFromInt(h.ptr);
}

export fn cw_bytes_len(id: u32) u32 {
    const h = getHandle(id, .bytes) orelse return 0;
    return @intCast(h.extra);
}

export fn cw_bytes_destroy(id: u32) void {
    const h = dropHandleTyped(id, .bytes) orelse return;
    const ptr: [*]u8 = @ptrFromInt(h.ptr);
    wasm_alloc.free(ptr[0..h.extra]);
}

// ---------------------------------------------------------------------------
// Packed encoding helpers
// ---------------------------------------------------------------------------

export fn cw_pack(ptr: [*]const u8, len: u32) u32 {
    const out = packing.pack(wasm_alloc, ptr[0..len]) catch return 0;
    return registerHandle(.bytes, @intFromPtr(out.ptr), out.len);
}

export fn cw_unpack(ptr: [*]const u8, len: u32) u32 {
    const out = packing.unpack(wasm_alloc, ptr[0..len]) catch return 0;
    return registerHandle(.bytes, @intFromPtr(out.ptr), out.len);
}

// ---------------------------------------------------------------------------
// Scratch buffers (zero-handle fast path for small messages)
// ---------------------------------------------------------------------------
// JS stages inbound bytes at `cw_in_ptr` (max length `cw_in_capacity`) and
// reads outbound bytes at `cw_out_ptr` (max length `cw_out_capacity`). The
// scratch builder is reused across calls, eliminating per-message alloc/free.

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

/// Encode a pull message into the output scratch buffer.
/// Returns the number of bytes written (or 0 on failure).
export fn cw_encode_pull(import_id: i64) u32 {
    return encodeFixed(.{ .pull = import_id });
}

export fn cw_encode_release(import_id: i64, refcount: u32) u32 {
    return encodeFixed(.{ .release = .{ .id = import_id, .refcount = refcount } });
}

const FixedMsg = union(enum) {
    pull: i64,
    release: struct { id: i64, refcount: u32 },
};

fn encodeFixed(msg: FixedMsg) u32 {
    // All these messages fit in a tiny single segment: header (8 bytes) +
    // 1 root pointer word + 2-3 data words. We encode directly into scratch_out.
    var out: []u8 = scratch_out[0..];

    switch (msg) {
        .pull => |id| {
            // Header: seg_count_minus_one=0, seg0_size=3 words.
            std.mem.writeInt(u32, out[0..4], 0, .little);
            std.mem.writeInt(u32, out[4..8], 3, .little);
            // Word 0: root pointer to struct at offset 0, data_words=2, ptr_words=0.
            const root = wire.Pointer.makeStruct(0, 2, 0);
            std.mem.writeInt(u64, out[8..16], root.raw, .little);
            // Word 1: tag (u16 at offset 0 of data section) = pull(1).
            // Wipe entire word first.
            @memset(out[16..24], 0);
            std.mem.writeInt(u16, out[16..18], @intFromEnum(rpc.MessageTag.pull), .little);
            // Word 2: import_id (u64 at offset 8 of data section).
            std.mem.writeInt(i64, out[24..32], id, .little);
            return 32;
        },
        .release => |r| {
            // 4 words = root + 3 data words (tag, id, refcount fits in word 3 with padding).
            std.mem.writeInt(u32, out[0..4], 0, .little);
            std.mem.writeInt(u32, out[4..8], 4, .little);
            const root = wire.Pointer.makeStruct(0, 3, 0);
            std.mem.writeInt(u64, out[8..16], root.raw, .little);
            @memset(out[16..40], 0);
            std.mem.writeInt(u16, out[16..18], @intFromEnum(rpc.MessageTag.release), .little);
            std.mem.writeInt(i64, out[24..32], r.id, .little);
            std.mem.writeInt(u32, out[32..36], r.refcount, .little);
            return 40;
        },
    }
}

/// Decode the message currently at scratch_in[0..len] in place. Returns the
/// MessageTag (>=0) or -1 on parse failure. After this call, the JS side
/// can fetch fields via cw_get_pull_id / cw_get_resolve_id / cw_get_release_refcount.
var last_parsed: ?wire.ParsedMessage = null;

export fn cw_decode_in(len: u32) i32 {
    if (last_parsed) |*lp| {
        lp.deinit();
        last_parsed = null;
    }
    const bytes = scratch_in[0..len];
    const parsed = wire.parseStreamFramed(wasm_alloc, bytes) catch return -1;
    last_parsed = parsed;
    return @intFromEnum(rpc.readMessageTag(parsed.root()));
}

export fn cw_get_pull_id() i64 {
    const lp = &(last_parsed orelse return 0);
    return rpc.readPullId(lp.root());
}

export fn cw_get_resolve_id() i64 {
    const lp = &(last_parsed orelse return 0);
    return rpc.readResolveOrRejectId(lp.root());
}

export fn cw_get_release_refcount() u32 {
    const lp = &(last_parsed orelse return 0);
    return rpc.readReleaseRefcount(lp.root());
}

export fn cw_decode_clear() void {
    if (last_parsed) |*lp| {
        lp.deinit();
        last_parsed = null;
    }
}

// ---------------------------------------------------------------------------
// Tape-driven encode/decode (single-call hot path for arbitrary value trees)
// ---------------------------------------------------------------------------
// A 2 MB bump arena backs the encoder so MessageBuilder allocations are O(1)
// pointer bumps. The arena is reset before each encode/decode to avoid any
// per-call allocation churn.

const CODEC_ARENA_SIZE: usize = 2 * 1024 * 1024;
var codec_arena_buf: [CODEC_ARENA_SIZE]u8 align(8) = undefined;
var codec_fba: std.heap.FixedBufferAllocator = .{ .end_index = 0, .buffer = &codec_arena_buf };

inline fn codecAllocator() std.mem.Allocator {
    codec_fba.reset();
    return codec_fba.allocator();
}

/// Encode a tape (in scratch_in[0..tape_len]) into Cap'n Proto bytes
/// (written directly into scratch_out). Returns the encoded length, or 0 on error.
export fn cw_encode_tape(tape_len: u32) u32 {
    const allocator = codecAllocator();
    const tape_bytes = scratch_in[0..tape_len];
    const written = tape.encodeTapeInto(allocator, tape_bytes, scratch_out[0..]) catch return 0;
    return @intCast(written);
}

/// Decode Cap'n Proto bytes (in scratch_in[0..len]) into a tape (written to
/// scratch_out). Returns the tape length, or 0 on error.
export fn cw_decode_to_tape(len: u32) u32 {
    const allocator = codecAllocator();
    const tape_len = tape.decodeMessage(allocator, scratch_in[0..len], scratch_out[0..]) catch return 0;
    return @intCast(tape_len);
}

// ---------------------------------------------------------------------------
// Version / capability probe
// ---------------------------------------------------------------------------

export fn cw_abi_version() u32 {
    return 3;
}
