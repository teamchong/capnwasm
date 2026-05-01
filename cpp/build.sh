#!/bin/bash
# Build the capnproto C++ runtime statically linked into wasm via `zig cc`.
# No emscripten. Output: zig-out/capnp_cpp.wasm

set -e
cd "$(dirname "$0")/.."

CAPNP_SRC=cpp/vendor
OUT=zig-out/capnp_cpp.wasm
mkdir -p zig-out

# Sources we need from kj — keep minimal, no async/io/network.
# trimSourceFilename in kj/exception.c++ does runtime path canonicalization
# we don't need (we already pre-strip "cpp/vendor/" via -ffile-prefix-map).
# Patch the function body to a single `return filename;` so the linker drops
# the ROOTS lookup table + the loop body. The patched copy lives in
# zig-out/patched-kj/ alongside symlinks back to the kj headers so its
# `#include "exception.h"` etc. still resolve.
mkdir -p zig-out/patched-kj
PATCHED_EXC=zig-out/patched-kj/exception.c++
# Refresh symlinks every build so newly added kj headers are visible
# without explicit re-symlinking.
for h in "$CAPNP_SRC"/kj/*.h; do
  ln -sf "$(cd "$(dirname "$h")" && pwd)/$(basename "$h")" "zig-out/patched-kj/$(basename "$h")"
done
if [ ! -f "$PATCHED_EXC" ] || [ "$CAPNP_SRC/kj/exception.c++" -nt "$PATCHED_EXC" ]; then
  python3 - "$CAPNP_SRC/kj/exception.c++" "$PATCHED_EXC" <<'PYEOF'
import sys, re
src = open(sys.argv[1]).read()
m = re.search(r"kj::StringPtr trimSourceFilename\(kj::StringPtr filename\) \{", src)
if not m:
    print("trimSourceFilename not found in exception.c++ — skipping patch", file=sys.stderr)
    open(sys.argv[2], "w").write(src)
    sys.exit(0)
start = m.start()
depth, i = 0, m.end() - 1
while i < len(src):
    if src[i] == '{': depth += 1
    elif src[i] == '}':
        depth -= 1
        if depth == 0: end = i + 1; break
    i += 1
patched = src[:start] + "kj::StringPtr trimSourceFilename(kj::StringPtr filename) { return filename; }" + src[end:]
open(sys.argv[2], "w").write(patched)
PYEOF
fi

KJ_SOURCES=(
  "$CAPNP_SRC/kj/common.c++"
  "$PATCHED_EXC"
  "$CAPNP_SRC/kj/debug.c++"
  "$CAPNP_SRC/kj/string.c++"
  "$CAPNP_SRC/kj/source-location.c++"
  "$CAPNP_SRC/kj/hash.c++"
  "$CAPNP_SRC/kj/array.c++"
  "$CAPNP_SRC/kj/memory.c++"
  "$CAPNP_SRC/kj/units.c++"
  # encoding.c++ removed — UTF-16/32 / wide / hex / URI helpers; capnwasm
  # works in UTF-8 only and does encode/decode on the JS side via TextEncoder.
  # io.c++ removed — only referenced from POSIX paths in exception.c++ we no-op.
  "$CAPNP_SRC/kj/mutex.c++"
  # time.c++ skipped: no time syscalls needed for serialize/deserialize.
  "$CAPNP_SRC/kj/arena.c++"
  "$CAPNP_SRC/kj/table.c++"
  "$CAPNP_SRC/kj/list.c++"
  "$CAPNP_SRC/kj/refcount.c++"
)
# Sources we're investigating for removal — flip to comment-out and rebuild
# to measure impact. Keep the canonical list above stable.

CAPNP_SOURCES=(
  "$CAPNP_SRC/capnp/c++.capnp.c++"
  "$CAPNP_SRC/capnp/blob.c++"
  "$CAPNP_SRC/capnp/arena.c++"
  "$CAPNP_SRC/capnp/layout.c++"
  "$CAPNP_SRC/capnp/any.c++"
  "$CAPNP_SRC/capnp/message.c++"
  "$CAPNP_SRC/capnp/serialize.c++"
  "$CAPNP_SRC/capnp/rpc.capnp.c++"
  # list.c++/stream.capnp.c++ removed — list is template-only at our usage
  # level; stream.capnp pulls in code we never call.
)

# Production runtime: only the wrapper itself + EH runtime + the schema.capnp
# generated code (used by the RPC layer for rpc.capnp accessors).
# Test-only schemas (typed/big/conformance) compile in only when BENCH_MODE=1.
WRAPPER=(
  cpp/wrapper.cpp
  cpp/eh_runtime.cpp
)
WRAPPER_BENCH_ONLY=(
  cpp/typed_schema.capnp.c++
  cpp/big_schema.capnp.c++
  cpp/conformance_schema.capnp.c++
)

# Pull in libcxxabi exception runtime that zig's wasm32-wasi-musl auto-build
# leaves out. KJ requires C++ exceptions; these provide __cxa_allocate_exception,
# __cxa_throw, and friends.
ZIG_LIBCXXABI=/Users/steven_chong/.local/share/mise/installs/zig/0.16.0/lib/libcxxabi/src
LIBCXXABI=()

# Compile flags. -fno-exceptions because wasm32-freestanding doesn't have
# C++ EH, and KJ has its own assert-style fallback when KJ_NO_EXCEPTIONS=1.
# bench mode includes 256-element function-pointer tables for BigUser
# helpers (cpp_make_big_user_bytes, cpp_big_user_emit_json, etc). Off by
# default — production users don't need them.
BENCH_MODE=0
if [ "${1:-}" = "bench" ]; then
  BENCH_MODE=1
  echo "[build.sh] CW_BENCH=1 — including bench helpers"
fi

FLAGS=(
  -target wasm32-wasi-musl
  -Oz
  -DCW_BENCH=$BENCH_MODE
  -std=c++23
  -fexceptions
  -fno-rtti
  -fno-threadsafe-statics
  -fno-stack-protector
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -fdata-sections
  -ffunction-sections
  -flto
  -fmerge-all-constants
  -D_WASI_EMULATED_SIGNAL
  -D_WASI_EMULATED_MMAN
  -DKJ_USE_MAIN=0
  -DKJ_NO_LIBDL=1
  -DNDEBUG
  -DKJ_NO_RTTI
  -DKJ_NO_STACK_TRACES_IN_RELEASE=1
  -I"$CAPNP_SRC"
  -Icpp
  -include cpp/kj_strip_strings.h
  # Strip the long "cpp/vendor/" prefix from __FILE__ source paths embedded
  # by KJ assertion macros at every throw site. Saves ~50 bytes gz; the
  # relative path within vendor (e.g. "kj/mutex.c++") is enough context
  # for anyone reading an exception location.
  -ffile-prefix-map=cpp/vendor/=
  -Wno-deprecated
  -Wno-unused-parameter
  -Wno-unknown-pragmas
  -Wl,--no-entry
  # Build in WASI "reactor" mode instead of the default "command" mode.
  # Command mode auto-links a crt1.o whose _start parses argv, calls
  # global ctors, calls main, then proc_exits (31k instructions, 76% of
  # the slim wasm's code section). We never invoke main — JS calls our
  # cpp_* exports directly. Reactor mode replaces _start with the much
  # smaller __wasm_call_ctors export that callers invoke if they need
  # ctors to run, and skips the WASI argv plumbing entirely.
  -mexec-model=reactor
  -Wl,--export=cpp_in_ptr
  -Wl,--export=cpp_out_ptr
  -Wl,--export=cpp_in_capacity
  -Wl,--export=cpp_abi_version
  # cpp_lazy_* and cpp_any_* are still needed by the production code paths
  # (cpp_loader scratch helpers, dynamic-API batch reads via cpp_lazy_open).
  -Wl,--export=cpp_lazy_open
  -Wl,--export=cpp_lazy_msg_obj_field_text
  -Wl,--export=cpp_lazy_obj_fields_text
  -Wl,--export=cpp_lazy_aux_ptr
  -Wl,--export=cpp_lazy_aux_capacity
  # cpp_serialize_tape / cpp_deserialize_to_tape are only used by
  # capnwasm/tape (the capnweb-shape compatibility layer). Moved to bench
  # mode + we ship a separate tape-enabled wasm if/when that subpath is
  # actually imported. Browser RPC/dynamic paths don't need them.
  -Wl,--export=cpp_any_open
  -Wl,--export=cpp_any_enter_struct
  -Wl,--export=cpp_any_leave_struct
  -Wl,--export=cpp_any_open_list
  -Wl,--export=cpp_any_enter_list_at
  -Wl,--export=cpp_any_list_get_uint8
  -Wl,--export=cpp_any_list_get_uint16
  -Wl,--export=cpp_any_list_get_uint32
  -Wl,--export=cpp_any_list_get_uint64
  -Wl,--export=cpp_any_list_get_float32_bits
  -Wl,--export=cpp_any_list_get_float64_bits
  -Wl,--export=cpp_any_list_get_bool
  -Wl,--export=cpp_any_list_get_text
  -Wl,--export=cpp_any_list_get_data
  -Wl,--export=cpp_any_text_at
  -Wl,--export=cpp_any_data_at
  -Wl,--export=cpp_any_int64_at
  -Wl,--export=cpp_any_uint32_at
  -Wl,--export=cpp_any_uint16_at
  -Wl,--export=cpp_any_uint8_at
  -Wl,--export=cpp_any_bool_at
  -Wl,--export=cpp_any_batch_read
  -Wl,--export=cpp_any_builder_init
  # NOTE: cpp_any_builder_set_uint8/16/32, set_int64_lo_hi, set_bool intentionally
  # not exported — JS writes data-section primitives directly via the cached
  # data_ptr offset, no wasm boundary call. Keeping the C++ definitions
  # available (extern "C") for tests that need to write via wasm; --gc-sections
  # drops them from the production wasm because nothing references them.
  -Wl,--export=cpp_any_builder_set_text
  -Wl,--export=cpp_any_builder_set_data
  -Wl,--export=cpp_any_builder_init_list_uint8
  -Wl,--export=cpp_any_builder_set_list_uint8
  -Wl,--export=cpp_any_builder_init_list_uint16
  -Wl,--export=cpp_any_builder_set_list_uint16
  -Wl,--export=cpp_any_builder_init_list_uint32
  -Wl,--export=cpp_any_builder_set_list_uint32
  -Wl,--export=cpp_any_builder_init_list_uint64
  -Wl,--export=cpp_any_builder_set_list_uint64
  -Wl,--export=cpp_any_builder_init_list_int8
  -Wl,--export=cpp_any_builder_set_list_int8
  -Wl,--export=cpp_any_builder_init_list_int16
  -Wl,--export=cpp_any_builder_set_list_int16
  -Wl,--export=cpp_any_builder_init_list_int32
  -Wl,--export=cpp_any_builder_set_list_int32
  -Wl,--export=cpp_any_builder_init_list_int64
  -Wl,--export=cpp_any_builder_set_list_int64
  -Wl,--export=cpp_any_builder_init_list_float32
  -Wl,--export=cpp_any_builder_set_list_float32
  -Wl,--export=cpp_any_builder_init_list_float64
  -Wl,--export=cpp_any_builder_set_list_float64
  -Wl,--export=cpp_any_builder_init_list_bool
  -Wl,--export=cpp_any_builder_set_list_bool
  -Wl,--export=cpp_any_builder_init_list_text
  -Wl,--export=cpp_any_builder_set_list_text
  -Wl,--export=cpp_any_builder_init_list_data
  -Wl,--export=cpp_any_builder_set_list_data
  # cpp_any_builder_set_struct_from_bytes — superseded by enter_struct/exit_struct,
  # left in source for tests but not exported in the production build.
  -Wl,--export=cpp_any_builder_enter_struct
  -Wl,--export=cpp_any_builder_exit_struct
  -Wl,--export=cpp_any_builder_init_list_struct
  -Wl,--export=cpp_any_builder_enter_list_element
  -Wl,--export=cpp_any_builder_finalize
  -Wl,--export=cpp_any_builder_data_ptr
  -Wl,--export=cpp_rpc_build_bootstrap
  -Wl,--export=cpp_rpc_build_call
  -Wl,--export=cpp_rpc_build_return
  -Wl,--export=cpp_rpc_build_release
  -Wl,--export=cpp_rpc_build_disembargo_receiver_loopback
  # cpp_rpc_build_{abort, resolve_*, disembargo_sender_loopback} — exported
  # only in bench mode (used by test harness to inject these frames at peers).
  # Production receivers handle the frames; they're not generated locally.
  -Wl,--export=cpp_rpc_get_abort_reason
  -Wl,--export=cpp_rpc_get_resolve_cap_id
  -Wl,--export=cpp_rpc_get_resolve_exception
  -Wl,--export=cpp_rpc_decode
  # Per-message getters that cpp_rpc_decode now writes inline at cpp_out
  # are no longer exported (JS reads via DataView). Bodies kept in source
  # for test-only paths; --gc-sections drops them from the production wasm.
  #   cpp_rpc_get_bootstrap_question_id
  #   cpp_rpc_get_call_summary, cpp_rpc_get_call_target_kind
  #   cpp_rpc_get_return_kind, cpp_rpc_get_return_summary
  #   cpp_rpc_get_finish_question_id
  #   cpp_rpc_get_release_id, cpp_rpc_get_release_refcount
  #   cpp_rpc_get_resolve_summary, cpp_rpc_get_disembargo_summary
  -Wl,--export=cpp_rpc_get_call_params
  -Wl,--export=cpp_rpc_get_return_results
  -Wl,--export=cpp_rpc_get_return_exception
  -Wl,--export=cpp_rpc_build_return_with_caps
  -Wl,--export=cpp_rpc_get_return_cap_kind
  -Wl,--export=cpp_rpc_get_return_cap_id
  -Wl,--export=cpp_rpc_begin_call
  -Wl,--export=cpp_rpc_begin_return
  -Wl,--export=cpp_rpc_finalize
  -Wl,--export=cpp_rpc_open_call_params
  -Wl,--export=cpp_rpc_open_return_results
  -lwasi-emulated-signal
  -lwasi-emulated-mman
  -Wl,--gc-sections
  -Wl,--strip-all
)

if [ "$BENCH_MODE" = "1" ]; then
  FLAGS+=(
    -Wl,--export=cpp_make_big_user_bytes
    -Wl,--export=cpp_big_user_all_packed
    -Wl,--export=cpp_big_user_emit_json
    -Wl,--export=cpp_typed_open
    -Wl,--export=cpp_typed_serialize_wide
    -Wl,--export=cpp_typed_field_at
    -Wl,--export=cpp_conformance_serialize
    # Test-only RPC builders (inject frames into peers in tests)
    -Wl,--export=cpp_rpc_build_abort
    -Wl,--export=cpp_rpc_build_resolve_cap
    -Wl,--export=cpp_rpc_build_resolve_exception
    -Wl,--export=cpp_rpc_build_disembargo_sender_loopback
    # Test-only setters that JS replaced with direct-memory writes
    -Wl,--export=cpp_any_builder_set_uint8
    -Wl,--export=cpp_any_builder_set_uint16
    -Wl,--export=cpp_any_builder_set_uint32
    -Wl,--export=cpp_any_builder_set_int64_lo_hi
    -Wl,--export=cpp_any_builder_set_bool
    -Wl,--export=cpp_any_builder_set_struct_from_bytes
    # Tape codec — only used by the capnwasm/tape subpath (capnweb-shape
    # serialize/deserialize). The slim build doesn't ship it; the bench
    # build (used by tests + the inlined Node bundle) keeps it.
    -Wl,--export=cpp_serialize_tape
    -Wl,--export=cpp_deserialize_to_tape
  )
  WRAPPER+=("${WRAPPER_BENCH_ONLY[@]}")
fi

zig c++ "${FLAGS[@]}" \
  -I"$ZIG_LIBCXXABI/../include" \
  "${KJ_SOURCES[@]}" \
  "${CAPNP_SOURCES[@]}" \
  "${WRAPPER[@]}" \
  "${LIBCXXABI[@]}" \
  -o "$OUT"

echo "Built: $OUT"
ls -la "$OUT"

# Strip + size-optimize.
OPT_OUT=zig-out/capnp_cpp.opt.wasm
wasm-opt "$OUT" \
  -Oz --converge \
  --strip-debug --strip-producers --strip-target-features \
  --enable-bulk-memory --enable-simd --enable-sign-ext --enable-nontrapping-float-to-int \
  -o "$OPT_OUT"
echo "Optimized: $OPT_OUT"
ls -la "$OPT_OUT"

# Two artifacts go into dist/:
#   dist/capnp.wasm       — full wasm (with bench/test helpers baked in),
#                           consumed by `import "capnwasm"` (inlined as
#                           base64) and tests that exercise typed/big/
#                           conformance schemas
#   dist/capnp.slim.wasm  — production-only wasm (no test helpers),
#                           served by `import "capnwasm/browser"` as a
#                           separately-fetched asset
#
# Building both requires two compilation passes (BENCH_MODE differs).
# A non-bench invocation produces capnp.slim.wasm and then recursively
# self-invokes in bench mode to produce capnp.wasm + dist/inlined.mjs.
if [ "$BENCH_MODE" = "1" ]; then
  node js/build_inlined.mjs   # writes dist/inlined.mjs
  cp "$OPT_OUT" dist/capnp.wasm
else
  cp "$OPT_OUT" dist/capnp.slim.wasm
  echo "[build.sh] building full bundle (for tests + default import)..."
  bash "$0" bench
fi
