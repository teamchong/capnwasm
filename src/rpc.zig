// Minimal capnweb-shaped RPC layer.
// Wire encoding mirrors capnweb's protocol.md (push/pull/resolve/reject/release/abort)
// but messages are encoded as Cap'n Proto rather than JSON. This is the core insight
// of capnwasm: keep the capnweb-style API and pipelining model, swap the codec to
// binary Cap'n Proto.
//
// Each top-level RPC message is a Cap'n Proto struct:
//   Message {
//     union {
//       push:    Expression;        # implicitly takes next positive import id
//       pull:    UInt32;            # import id
//       resolve: { id, expr };
//       reject:  { id, expr };
//       release: { id, refcount };
//       stream:  Expression;
//       abort:   Expression;
//     }
//   }
//
// Expressions are recursive. A minimal initial set:
//   - literal: Value (null, bool, i64, f64, text, data)
//   - import:  UInt32          # reference an existing import id
//   - export:  UInt32          # introduce a new export id
//   - pipeline: { source: Expression, path: List(Text), args?: Expression }
//   - error:   { type: Text, message: Text }
//
// This file implements the bookkeeping (imports/exports tables, id allocation,
// ref-counting) and the transport-agnostic state machine. The actual byte
// encoding lives in `wire.zig`.

const std = @import("std");
const wire = @import("wire.zig");

pub const ImportId = i64; // negative ids are exporter-chosen, positive are importer-chosen
pub const ExportId = i64;

pub const Refcount = u32;

pub const ImportEntry = struct {
    id: ImportId,
    refcount: Refcount,
    /// Promise resolution payload, if resolved. Owned by the session.
    resolved: ?[]u8 = null,
    rejected: ?[]u8 = null,
    /// Whether the importer has issued a pull and expects a resolution.
    pulled: bool = false,
};

pub const ExportEntry = struct {
    id: ExportId,
    /// How many times this export has been introduced. Decremented by release messages.
    introduced: u32,
    /// Opaque target identifier supplied by the host (e.g. JS function pointer).
    target: u64,
};

pub const Session = struct {
    allocator: std.mem.Allocator,

    imports: std.AutoHashMapUnmanaged(ImportId, ImportEntry) = .{},
    exports: std.AutoHashMapUnmanaged(ExportId, ExportEntry) = .{},

    /// Next positive import id (importer-chosen) and next negative export id
    /// (exporter-chosen). Per protocol.md ids are never reused.
    next_import_id: ImportId = 1,
    next_export_id: ExportId = -1,

    pub fn init(allocator: std.mem.Allocator) Session {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Session) void {
        var it = self.imports.iterator();
        while (it.next()) |e| {
            if (e.value_ptr.resolved) |b| self.allocator.free(b);
            if (e.value_ptr.rejected) |b| self.allocator.free(b);
        }
        self.imports.deinit(self.allocator);
        self.exports.deinit(self.allocator);
    }

    pub fn allocateImportId(self: *Session) !ImportId {
        const id = self.next_import_id;
        self.next_import_id += 1;
        try self.imports.put(self.allocator, id, .{ .id = id, .refcount = 1 });
        return id;
    }

    pub fn allocateExportId(self: *Session, target: u64) !ExportId {
        const id = self.next_export_id;
        self.next_export_id -= 1;
        try self.exports.put(self.allocator, id, .{ .id = id, .introduced = 1, .target = target });
        return id;
    }

    pub fn releaseImport(self: *Session, id: ImportId, refcount: Refcount) void {
        const entry = self.imports.getPtr(id) orelse return;
        if (entry.refcount <= refcount) {
            if (entry.resolved) |b| self.allocator.free(b);
            if (entry.rejected) |b| self.allocator.free(b);
            _ = self.imports.remove(id);
        } else {
            entry.refcount -= refcount;
        }
    }

    pub fn markPulled(self: *Session, id: ImportId) void {
        const entry = self.imports.getPtr(id) orelse return;
        entry.pulled = true;
    }

    pub fn resolveImport(self: *Session, id: ImportId, payload: []const u8) !void {
        const entry = self.imports.getPtr(id) orelse return error.UnknownImport;
        if (entry.resolved != null or entry.rejected != null) return error.AlreadyResolved;
        entry.resolved = try self.allocator.dupe(u8, payload);
    }

    pub fn rejectImport(self: *Session, id: ImportId, payload: []const u8) !void {
        const entry = self.imports.getPtr(id) orelse return error.UnknownImport;
        if (entry.resolved != null or entry.rejected != null) return error.AlreadyResolved;
        entry.rejected = try self.allocator.dupe(u8, payload);
    }
};

/// Top-level message tag, mirroring capnweb's protocol but encoded as a
/// Cap'n Proto union discriminator.
pub const MessageTag = enum(u16) {
    push = 0,
    pull = 1,
    resolve = 2,
    reject = 3,
    release = 4,
    stream = 5,
    abort = 6,
    pipe = 7,
};

pub const ExpressionTag = enum(u16) {
    null_ = 0,
    bool_ = 1,
    int_ = 2,
    float_ = 3,
    text = 4,
    data = 5,
    array = 6,
    object = 7,
    import = 8,
    export_ = 9,
    pipeline = 10,
    error_ = 11,
    date = 12,
    bigint = 13,
    undefined_ = 14,
};

/// Build a top-level RPC message. The caller selects which variant via
/// `setMessageTag` and then fills in the appropriate fields.
pub fn buildPushMessage(builder: *wire.MessageBuilder, expr_data_words: u16, expr_ptr_words: u16) !struct {
    root: wire.StructBuilder,
    expr: wire.StructBuilder,
} {
    // Root struct: 1 data word (tag) + 1 pointer (expression).
    const root = try builder.initRoot(1, 1);
    root.setU16(0, @intFromEnum(MessageTag.push));
    const expr = try root.initStruct(0, expr_data_words, expr_ptr_words);
    return .{ .root = root, .expr = expr };
}

pub fn buildPullMessage(builder: *wire.MessageBuilder, import_id: ImportId) !void {
    const root = try builder.initRoot(2, 0);
    root.setU16(0, @intFromEnum(MessageTag.pull));
    root.setU64(8, @bitCast(import_id));
}

pub fn buildResolveMessage(
    builder: *wire.MessageBuilder,
    export_id: ExportId,
    expr_data_words: u16,
    expr_ptr_words: u16,
) !struct {
    root: wire.StructBuilder,
    expr: wire.StructBuilder,
} {
    const root = try builder.initRoot(2, 1);
    root.setU16(0, @intFromEnum(MessageTag.resolve));
    root.setU64(8, @bitCast(export_id));
    const expr = try root.initStruct(0, expr_data_words, expr_ptr_words);
    return .{ .root = root, .expr = expr };
}

pub fn buildRejectMessage(
    builder: *wire.MessageBuilder,
    export_id: ExportId,
    expr_data_words: u16,
    expr_ptr_words: u16,
) !struct {
    root: wire.StructBuilder,
    expr: wire.StructBuilder,
} {
    const root = try builder.initRoot(2, 1);
    root.setU16(0, @intFromEnum(MessageTag.reject));
    root.setU64(8, @bitCast(export_id));
    const expr = try root.initStruct(0, expr_data_words, expr_ptr_words);
    return .{ .root = root, .expr = expr };
}

pub fn buildReleaseMessage(builder: *wire.MessageBuilder, import_id: ImportId, refcount: Refcount) !void {
    const root = try builder.initRoot(3, 0);
    root.setU16(0, @intFromEnum(MessageTag.release));
    root.setU64(8, @bitCast(import_id));
    root.setU32(16, refcount);
}

pub fn readMessageTag(reader: wire.StructReader) MessageTag {
    return @enumFromInt(reader.readU16(0, 0));
}

pub fn readPullId(reader: wire.StructReader) ImportId {
    return @bitCast(reader.readU64(8, 0));
}

pub fn readResolveOrRejectId(reader: wire.StructReader) ExportId {
    return @bitCast(reader.readU64(8, 0));
}

pub fn readReleaseId(reader: wire.StructReader) ImportId {
    return @bitCast(reader.readU64(8, 0));
}

pub fn readReleaseRefcount(reader: wire.StructReader) Refcount {
    return reader.readU32(16, 0);
}

pub fn readExpression(reader: wire.StructReader) wire.StructReader {
    return reader.readStruct(0);
}

pub fn writeExpressionTag(b: wire.StructBuilder, tag: ExpressionTag) void {
    b.setU16(0, @intFromEnum(tag));
}

pub fn readExpressionTag(reader: wire.StructReader) ExpressionTag {
    return @enumFromInt(reader.readU16(0, 0));
}

/// Encode a literal expression: text payload.
pub fn buildTextExpression(b: wire.StructBuilder, text: []const u8) !void {
    writeExpressionTag(b, .text);
    try b.setText(0, text);
}

pub fn buildIntExpression(b: wire.StructBuilder, value: i64) void {
    writeExpressionTag(b, .int_);
    b.setU64(8, @bitCast(value));
}

pub fn buildFloatExpression(b: wire.StructBuilder, value: f64) void {
    writeExpressionTag(b, .float_);
    b.setU64(8, @bitCast(value));
}

pub fn buildBoolExpression(b: wire.StructBuilder, value: bool) void {
    writeExpressionTag(b, .bool_);
    b.setBool(16, value);
}

pub fn buildNullExpression(b: wire.StructBuilder) void {
    writeExpressionTag(b, .null_);
}

pub fn buildImportExpression(b: wire.StructBuilder, id: ImportId) void {
    writeExpressionTag(b, .import);
    b.setU64(8, @bitCast(id));
}

pub fn buildExportExpression(b: wire.StructBuilder, id: ExportId) void {
    writeExpressionTag(b, .export_);
    b.setU64(8, @bitCast(id));
}

/// pipeline: { source, path[], args? } — source occupies pointer 0,
/// path list occupies pointer 1, args occupies pointer 2.
pub fn buildPipelineExpression(
    b: wire.StructBuilder,
    path_count: u32,
) !struct {
    source: wire.StructBuilder,
    path: wire.ListBuilder,
} {
    writeExpressionTag(b, .pipeline);
    const source = try b.initStruct(0, 1, 1);
    const path = try b.initListPrim(1, .pointer, path_count);
    return .{ .source = source, .path = path };
}
