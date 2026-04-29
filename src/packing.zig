// Cap'n Proto packed encoding.
// Spec: each 8-byte word is preceded by a tag byte where bit n indicates whether
// the n-th byte of that word is non-zero. After the tag come only the non-zero
// bytes. Two special tag values:
//   0x00 — followed by a count byte N; the next N words are also zero (so
//          N+1 zero words are implied total).
//   0xFF — followed by a count byte N; the next N words are passed through
//          unpacked.

const std = @import("std");

pub fn pack(allocator: std.mem.Allocator, src: []const u8) ![]u8 {
    if (src.len % 8 != 0) return error.UnalignedInput;
    var out = try std.ArrayList(u8).initCapacity(allocator, src.len);
    defer out.deinit(allocator);

    var i: usize = 0;
    while (i < src.len) {
        const word = src[i .. i + 8];
        var tag: u8 = 0;
        for (word, 0..) |b, n| if (b != 0) {
            tag |= @as(u8, 1) << @intCast(n);
        };

        if (tag == 0) {
            // Run of zero words.
            try out.append(allocator, 0);
            const start = i + 8;
            var run: u8 = 0;
            var j = start;
            while (j < src.len and run < 255) : (j += 8) {
                var z: bool = true;
                for (src[j .. j + 8]) |b| if (b != 0) {
                    z = false;
                    break;
                };
                if (!z) break;
                run += 1;
            }
            try out.append(allocator, run);
            i = j;
            continue;
        }

        if (tag == 0xFF) {
            try out.append(allocator, 0xFF);
            try out.appendSlice(allocator, word);
            // Run of mostly-non-zero words (>= 7 non-zero bytes per word).
            const start = i + 8;
            var run: u8 = 0;
            var j = start;
            while (j < src.len and run < 255) : (j += 8) {
                var nz: u32 = 0;
                for (src[j .. j + 8]) |b| if (b != 0) {
                    nz += 1;
                };
                if (nz < 7) break;
                run += 1;
            }
            try out.append(allocator, run);
            try out.appendSlice(allocator, src[start .. start + @as(usize, run) * 8]);
            i = start + @as(usize, run) * 8;
            continue;
        }

        try out.append(allocator, tag);
        for (word, 0..) |b, n| {
            if (((tag >> @intCast(n)) & 1) != 0) try out.append(allocator, b);
        }
        i += 8;
    }
    return out.toOwnedSlice(allocator);
}

pub fn unpack(allocator: std.mem.Allocator, src: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);

    var i: usize = 0;
    while (i < src.len) {
        const tag = src[i];
        i += 1;

        if (tag == 0) {
            if (i >= src.len) return error.TruncatedPacked;
            const run = src[i];
            i += 1;
            const total_zero_words: usize = @as(usize, run) + 1;
            try out.appendNTimes(allocator, 0, total_zero_words * 8);
            continue;
        }

        if (tag == 0xFF) {
            if (i + 8 > src.len) return error.TruncatedPacked;
            try out.appendSlice(allocator, src[i .. i + 8]);
            i += 8;
            if (i >= src.len) return error.TruncatedPacked;
            const run = src[i];
            i += 1;
            const len = @as(usize, run) * 8;
            if (i + len > src.len) return error.TruncatedPacked;
            try out.appendSlice(allocator, src[i .. i + len]);
            i += len;
            continue;
        }

        var word: [8]u8 = .{ 0, 0, 0, 0, 0, 0, 0, 0 };
        var n: u8 = 0;
        while (n < 8) : (n += 1) {
            if (((tag >> @intCast(n)) & 1) != 0) {
                if (i >= src.len) return error.TruncatedPacked;
                word[n] = src[i];
                i += 1;
            }
        }
        try out.appendSlice(allocator, &word);
    }
    return out.toOwnedSlice(allocator);
}
