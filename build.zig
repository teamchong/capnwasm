const std = @import("std");

pub fn build(b: *std.Build) void {
    const native_target = b.standardTargetOptions(.{});
    const native_optimize = b.standardOptimizeOption(.{});

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_features_add = std.Target.wasm.featureSet(&.{
            .simd128,
            .bulk_memory,
            .sign_ext,
            .nontrapping_fptoint,
        }),
    });

    const wasm_mod = b.createModule(.{
        .root_source_file = b.path("src/wasm.zig"),
        .target = wasm_target,
        .optimize = .ReleaseSmall,
        .strip = true,
        .unwind_tables = .none,
    });

    const wasm = b.addExecutable(.{
        .name = "capnwasm",
        .root_module = wasm_mod,
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.import_memory = false;
    wasm.export_memory = true;

    const install_wasm = b.addInstallArtifact(wasm, .{});
    b.getInstallStep().dependOn(&install_wasm.step);

    const wasm_step = b.step("wasm", "Build WASM module");
    wasm_step.dependOn(&install_wasm.step);

    const wasm_opt = b.addSystemCommand(&.{
        "wasm-opt",
        "-Oz",
        "--converge",
        "--enable-bulk-memory",
        "--enable-simd",
        "--enable-sign-ext",
        "--enable-nontrapping-float-to-int",
        "--strip-debug",
        "--strip-producers",
        "--strip-target-features",
    });
    wasm_opt.addArtifactArg(wasm);
    wasm_opt.addArg("-o");
    const opt_out = wasm_opt.addOutputFileArg("capnwasm.opt.wasm");

    const install_opt = b.addInstallFile(opt_out, "capnwasm.opt.wasm");
    install_opt.step.dependOn(&install_wasm.step);

    const opt_step = b.step("opt", "Build + wasm-opt -O3");
    opt_step.dependOn(&install_opt.step);

    // Hand-written WasmGC module: assemble WAT and run wasm-opt.
    const gc_assemble = b.addSystemCommand(&.{
        "wasm-as",
        "wat/gc_decode.wat",
        "--enable-gc",
        "--enable-reference-types",
        "--enable-bulk-memory",
        "-o",
    });
    const gc_raw = gc_assemble.addOutputFileArg("gc_decode.raw.wasm");

    const gc_opt = b.addSystemCommand(&.{
        "wasm-opt",
        "-Oz",
        "--converge",
        "--enable-gc",
        "--enable-reference-types",
        "--enable-bulk-memory",
        "--strip-debug",
        "--strip-producers",
    });
    gc_opt.addFileArg(gc_raw);
    gc_opt.addArg("-o");
    const gc_out = gc_opt.addOutputFileArg("gc_decode.wasm");

    const install_gc = b.addInstallFile(gc_out, "gc_decode.wasm");
    opt_step.dependOn(&install_gc.step);

    const test_step = b.step("test", "Run unit tests");
    const unit_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/test.zig"),
            .target = native_target,
            .optimize = native_optimize,
        }),
    });
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);
}
