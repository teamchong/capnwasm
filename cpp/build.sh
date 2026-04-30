#!/bin/bash
# Build the capnproto C++ runtime statically linked into wasm via `zig cc`.
# No emscripten. Output: zig-out/capnp_cpp.wasm

set -e
cd "$(dirname "$0")/.."

CAPNP_SRC=cpp/vendor
OUT=zig-out/capnp_cpp.wasm
mkdir -p zig-out

# Sources we need from kj — keep minimal, no async/io/network.
KJ_SOURCES=(
  "$CAPNP_SRC/kj/common.c++"
  "$CAPNP_SRC/kj/exception.c++"
  "$CAPNP_SRC/kj/debug.c++"
  "$CAPNP_SRC/kj/string.c++"
  "$CAPNP_SRC/kj/source-location.c++"
  "$CAPNP_SRC/kj/hash.c++"
  "$CAPNP_SRC/kj/array.c++"
  "$CAPNP_SRC/kj/memory.c++"
  "$CAPNP_SRC/kj/units.c++"
  "$CAPNP_SRC/kj/encoding.c++"
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
  -Wno-deprecated
  -Wno-unused-parameter
  -Wno-unknown-pragmas
  -Wl,--no-entry
  -Wl,--export=cpp_in_ptr
  -Wl,--export=cpp_out_ptr
  -Wl,--export=cpp_in_capacity
  -Wl,--export=cpp_out_capacity
  -Wl,--export=cpp_abi_version
  -Wl,--export=cpp_serialize_tape
  -Wl,--export=cpp_deserialize_to_tape
  -Wl,--export=cpp_lazy_open
  -Wl,--export=cpp_lazy_msg_obj_field_text
  -Wl,--export=cpp_lazy_obj_fields_text
  -Wl,--export=cpp_lazy_aux_ptr
  -Wl,--export=cpp_lazy_aux_capacity
  -Wl,--export=cpp_any_open
  -Wl,--export=cpp_any_enter_struct
  -Wl,--export=cpp_any_leave_struct
  -Wl,--export=cpp_any_open_list
  -Wl,--export=cpp_any_enter_list_at
  -Wl,--export=cpp_any_list_size
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
  -Wl,--export=cpp_any_builder_set_uint8
  -Wl,--export=cpp_any_builder_set_uint16
  -Wl,--export=cpp_any_builder_set_uint32
  -Wl,--export=cpp_any_builder_set_int64_lo_hi
  -Wl,--export=cpp_any_builder_set_bool
  -Wl,--export=cpp_any_builder_set_text
  -Wl,--export=cpp_any_builder_set_data
  -Wl,--export=cpp_any_builder_finalize
  -Wl,--export=cpp_any_builder_data_ptr
  -Wl,--export=cpp_any_builder_data_size
  -Wl,--export=cpp_rpc_build_bootstrap
  -Wl,--export=cpp_rpc_build_call
  -Wl,--export=cpp_rpc_build_return
  -Wl,--export=cpp_rpc_build_finish
  -Wl,--export=cpp_rpc_build_release
  -Wl,--export=cpp_rpc_decode
  -Wl,--export=cpp_rpc_get_bootstrap_question_id
  -Wl,--export=cpp_rpc_get_call_summary
  -Wl,--export=cpp_rpc_get_call_question_id
  -Wl,--export=cpp_rpc_get_call_interface_id
  -Wl,--export=cpp_rpc_get_call_method_id
  -Wl,--export=cpp_rpc_get_call_target_kind
  -Wl,--export=cpp_rpc_get_call_target_id
  -Wl,--export=cpp_rpc_get_call_params
  -Wl,--export=cpp_rpc_get_return_answer_id
  -Wl,--export=cpp_rpc_get_return_kind
  -Wl,--export=cpp_rpc_get_return_summary
  -Wl,--export=cpp_rpc_get_return_results
  -Wl,--export=cpp_rpc_get_return_exception
  -Wl,--export=cpp_rpc_get_finish_question_id
  -Wl,--export=cpp_rpc_get_release_id
  -Wl,--export=cpp_rpc_get_release_refcount
  -Wl,--export=cpp_rpc_build_return_with_caps
  -Wl,--export=cpp_rpc_get_return_cap_count
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
