const std = @import("std");
const wire = @import("wire.zig");
const rpc = @import("rpc.zig");
const packing = @import("packing.zig");

test "Pointer struct round-trip" {
    const p = wire.Pointer.makeStruct(3, 5, 2);
    try std.testing.expectEqual(wire.PointerKind.struct_, p.kind());
    try std.testing.expectEqual(@as(i32, 3), p.offset());
    try std.testing.expectEqual(@as(u16, 5), p.structDataSize());
    try std.testing.expectEqual(@as(u16, 2), p.structPtrSize());
}

test "Pointer struct negative offset" {
    const p = wire.Pointer.makeStruct(-1, 0, 0);
    try std.testing.expectEqual(@as(i32, -1), p.offset());
}

test "Pointer list round-trip" {
    const p = wire.Pointer.makeList(7, .four_bytes, 100);
    try std.testing.expectEqual(wire.PointerKind.list, p.kind());
    try std.testing.expectEqual(@as(i32, 7), p.offset());
    try std.testing.expectEqual(wire.ElementSize.four_bytes, p.listElemSize());
    try std.testing.expectEqual(@as(u32, 100), p.listElemCount());
}

test "Pointer far round-trip" {
    const p = wire.Pointer.makeFar(true, 42, 9);
    try std.testing.expectEqual(wire.PointerKind.far, p.kind());
    try std.testing.expectEqual(true, p.farIsDouble());
    try std.testing.expectEqual(@as(u32, 42), p.farOffset());
    try std.testing.expectEqual(@as(u32, 9), p.farSegment());
}

test "Build single-segment struct and read it back" {
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 64);
    defer mb.deinit();

    const root = try mb.initRoot(2, 2);
    root.setU32(0, 0xDEADBEEF);
    root.setU16(4, 0x1337);
    root.setU64(8, 0x0102030405060708);
    try root.setText(0, "hello");

    const child = try root.initStruct(1, 1, 0);
    child.setU64(0, 0xCAFEBABE_CAFEBABE);

    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();

    const r = parsed.root();
    try std.testing.expectEqual(@as(u32, 0xDEADBEEF), r.readU32(0, 0));
    try std.testing.expectEqual(@as(u16, 0x1337), r.readU16(4, 0));
    try std.testing.expectEqual(@as(u64, 0x0102030405060708), r.readU64(8, 0));
    try std.testing.expectEqualStrings("hello", r.readText(0));

    const child_r = r.readStruct(1);
    try std.testing.expectEqual(@as(u64, 0xCAFEBABE_CAFEBABE), child_r.readU64(0, 0));
}

test "Build composite list and iterate" {
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 64);
    defer mb.deinit();

    const root = try mb.initRoot(0, 1);
    const lb = try root.initListComposite(0, 3, 1, 0);
    lb.getStruct(0).setU64(0, 100);
    lb.getStruct(1).setU64(0, 200);
    lb.getStruct(2).setU64(0, 300);

    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();

    const list = parsed.root().readList(0);
    try std.testing.expectEqual(wire.ElementSize.composite, list.elem_size);
    try std.testing.expectEqual(@as(u32, 3), list.count);
    try std.testing.expectEqual(@as(u64, 100), list.getStruct(0).readU64(0, 0));
    try std.testing.expectEqual(@as(u64, 200), list.getStruct(1).readU64(0, 0));
    try std.testing.expectEqual(@as(u64, 300), list.getStruct(2).readU64(0, 0));
}

test "Build primitive list of u32" {
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 32);
    defer mb.deinit();

    const root = try mb.initRoot(0, 1);
    const lb = try root.initListPrim(0, .four_bytes, 4);
    lb.setU32(0, 1);
    lb.setU32(1, 2);
    lb.setU32(2, 3);
    lb.setU32(3, 4);

    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();

    const list = parsed.root().readList(0);
    try std.testing.expectEqual(@as(u32, 4), list.count);
    try std.testing.expectEqual(@as(u32, 1), list.getU32(0));
    try std.testing.expectEqual(@as(u32, 2), list.getU32(1));
    try std.testing.expectEqual(@as(u32, 3), list.getU32(2));
    try std.testing.expectEqual(@as(u32, 4), list.getU32(3));
}

test "Default-valued reads on truncated struct" {
    // A struct pointer claiming 0 data words should return defaults.
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 8);
    defer mb.deinit();
    const root = try mb.initRoot(0, 0);
    _ = root;

    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();

    const r = parsed.root();
    try std.testing.expectEqual(@as(u32, 0xDEAD), r.readU32(0, 0xDEAD));
}

test "Packed: round trip empty" {
    const empty = [_]u8{};
    const packed_bytes = try packing.pack(std.testing.allocator, &empty);
    defer std.testing.allocator.free(packed_bytes);
    try std.testing.expectEqual(@as(usize, 0), packed_bytes.len);
}

test "Packed: round trip zero word" {
    const zeros = [_]u8{0} ** 8;
    const packed_bytes = try packing.pack(std.testing.allocator, &zeros);
    defer std.testing.allocator.free(packed_bytes);
    // tag=0 + run=0 = 2 bytes
    try std.testing.expectEqual(@as(usize, 2), packed_bytes.len);
    try std.testing.expectEqual(@as(u8, 0), packed_bytes[0]);
    try std.testing.expectEqual(@as(u8, 0), packed_bytes[1]);

    const unpacked = try packing.unpack(std.testing.allocator, packed_bytes);
    defer std.testing.allocator.free(unpacked);
    try std.testing.expectEqualSlices(u8, &zeros, unpacked);
}

test "Packed: round trip mixed" {
    const src: []const u8 = &[_]u8{
        0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22,
    };
    const packed_bytes = try packing.pack(std.testing.allocator, src);
    defer std.testing.allocator.free(packed_bytes);

    const unpacked = try packing.unpack(std.testing.allocator, packed_bytes);
    defer std.testing.allocator.free(unpacked);
    try std.testing.expectEqualSlices(u8, src, unpacked);
}

test "RPC session id allocation" {
    var s = rpc.Session.init(std.testing.allocator);
    defer s.deinit();

    const imp1 = try s.allocateImportId();
    const imp2 = try s.allocateImportId();
    try std.testing.expectEqual(@as(rpc.ImportId, 1), imp1);
    try std.testing.expectEqual(@as(rpc.ImportId, 2), imp2);

    const exp1 = try s.allocateExportId(0xAAAA);
    const exp2 = try s.allocateExportId(0xBBBB);
    try std.testing.expectEqual(@as(rpc.ExportId, -1), exp1);
    try std.testing.expectEqual(@as(rpc.ExportId, -2), exp2);
}

test "RPC build/parse pull and release messages" {
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 8);
    defer mb.deinit();
    try rpc.buildPullMessage(&mb, 42);
    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();
    const r = parsed.root();
    try std.testing.expectEqual(rpc.MessageTag.pull, rpc.readMessageTag(r));
    try std.testing.expectEqual(@as(rpc.ImportId, 42), rpc.readPullId(r));
}

test "RPC build/parse push with text expression" {
    var mb = try wire.MessageBuilder.init(std.testing.allocator, 16);
    defer mb.deinit();
    const built = try rpc.buildPushMessage(&mb, 2, 1);
    try rpc.buildTextExpression(built.expr, "hello.world");
    const bytes = try mb.toBytes(std.testing.allocator);
    defer std.testing.allocator.free(bytes);

    var parsed = try wire.parseStreamFramed(std.testing.allocator, bytes);
    defer parsed.deinit();
    const r = parsed.root();
    try std.testing.expectEqual(rpc.MessageTag.push, rpc.readMessageTag(r));
    const expr = rpc.readExpression(r);
    try std.testing.expectEqual(rpc.ExpressionTag.text, rpc.readExpressionTag(expr));
    try std.testing.expectEqualStrings("hello.world", expr.readText(0));
}
