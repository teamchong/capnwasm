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

# Same trick for kj/debug.c++: KJ_SYSCALL formatting calls strerror_r(errno,
# buffer, sizeof(buffer)) which would otherwise pull libc's strerror_r and
# the ~1.5 KB errno-name table into the wasm. We never make syscalls in
# wasm, so the SYSCALL-style branch is unreachable; replace the strerror_r
# calls with empty-string assignments at compile time. Saves ~1.5 KB raw /
# ~700 B gzip on top of every other strip pass.
PATCHED_DBG=zig-out/patched-kj/debug.c++
if [ ! -f "$PATCHED_DBG" ] || [ "$CAPNP_SRC/kj/debug.c++" -nt "$PATCHED_DBG" ]; then
  python3 - "$CAPNP_SRC/kj/debug.c++" "$PATCHED_DBG" <<'PYEOF'
import sys, re
src = open(sys.argv[1]).read()
# Both forms KJ uses:
#   sysErrorArray = strerror_r(errorNumber, buffer, sizeof(buffer));
#   strerror_r(errorNumber, buffer, sizeof(buffer));
# Replace the strerror_r(...) call with an inline expression that writes
# an empty string into buffer and returns the buffer pointer, so the libc
# symbol is never referenced and --gc-sections drops the errno table.
patched = re.sub(
    r"strerror_r\(\s*errorNumber\s*,\s*buffer\s*,\s*sizeof\(buffer\)\s*\)",
    "((buffer[0] = 0), (const char*)buffer)",
    src,
)
open(sys.argv[2], "w").write(patched)
PYEOF
fi

KJ_SOURCES=(
  "$CAPNP_SRC/kj/common.c++"
  "$PATCHED_EXC"
  "$PATCHED_DBG"
  "$CAPNP_SRC/kj/string.c++"
  # source-location.c++, units.c++, hash.c++, list.c++, refcount.c++:
  # confirmed unreferenced by the production link (verified by removing
  # one at a time and observing the linker doesn't emit any undefined
  # symbol). With -ffunction-sections + --gc-sections their dead code
  # was already gone, so removing them from the source list is purely
  # build-time hygiene; final wasm bytes are identical.
  "$CAPNP_SRC/kj/array.c++"
  "$CAPNP_SRC/kj/memory.c++"
  # units.c++ now needed: with -frtti the layout.c++ paths reference
  # kj::ThrowOverflow whose operator() lives here. Previously dropped
  # because -fno-rtti silenced the references.
  "$CAPNP_SRC/kj/units.c++"
  # encoding.c++ removed — UTF-16/32 / wide / hex / URI helpers; capnwasm
  # works in UTF-8 only and does encode/decode on the JS side via TextEncoder.
  # io.c++ now needed because serialize-packed.c++ uses the buffered I/O
  # stream wrappers for packed-encoding round trips.
  "$CAPNP_SRC/kj/io.c++"
  "$CAPNP_SRC/kj/mutex.c++"
  # time.c++ skipped: no time syscalls needed for serialize/deserialize.
  "$CAPNP_SRC/kj/arena.c++"
  "$CAPNP_SRC/kj/table.c++"
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
  "$CAPNP_SRC/capnp/serialize-packed.c++"
  "$CAPNP_SRC/capnp/rpc.capnp.c++"
  # list.c++/stream.capnp.c++ removed — list is template-only at our usage
  # level; stream.capnp pulls in code we never call.
)

# Production runtime: only the wrapper itself + the schema.capnp generated
# code (used by the RPC layer for rpc.capnp accessors). This wasm does not
# catch C++ exceptions, so it uses tiny trap-on-throw ABI stubs instead of
# linking libcxxabi+libunwind. The separate schema-compiler wasm built by
# cpp/build_capnpc.sh still links the real wasm-EH runtime because it catches
# kj::Exception and reports schema errors cleanly.
# Test-only schemas (typed/big/conformance) compile in only when BENCH_MODE=1.
WRAPPER=(
  cpp/wrapper.cpp
  cpp/eh_runtime.cpp
  cpp/avatar.cpp
)
WRAPPER_BENCH_ONLY=(
  cpp/typed_schema.capnp.c++
  cpp/big_schema.capnp.c++
  cpp/conformance_schema.capnp.c++
)

# Locate `zig`. We keep the runtime and compiler builds on the same zig 0.17+
# toolchain: cpp/build_capnpc.sh needs its wasm-ld for real wasm-EH, and using
# one pinned toolchain avoids browser/runtime drift across artifacts. Resolution order:
#   1. ZIG_BIN env var (explicit override)
#   2. .capnwasm-zig symlink in repo root (set up by
#      scripts/install-zig-eh.sh — recommended path)
#   3. zig on PATH
if [ -z "${ZIG_BIN:-}" ]; then
  if [ -x ".capnwasm-zig/zig" ]; then
    ZIG_BIN="$(cd .capnwasm-zig && pwd)/zig"
  else
    ZIG_BIN="$(command -v zig || true)"
  fi
fi
if [ -z "$ZIG_BIN" ]; then
  echo "[build.sh] error: zig not found." >&2
  echo "[build.sh]        Run: bash scripts/install-zig-eh.sh" >&2
  exit 1
fi
ZIG_VERSION_STR="$("$ZIG_BIN" version)"
case "$ZIG_VERSION_STR" in
  0.16.*|0.15.*|0.14.*|0.13.*)
    echo "[build.sh] error: zig $ZIG_VERSION_STR is too old for capnwasm's pinned wasm toolchain." >&2
    echo "[build.sh]        Run: bash scripts/install-zig-eh.sh" >&2
    echo "[build.sh]        (downloads zig 0.17 to ~/.local/share/capnwasm-zig/)" >&2
    exit 1
    ;;
esac

# Compile flags. Runtime wasm uses normal C++ exception codegen plus
# cpp/eh_runtime.cpp's trap-on-throw ABI stubs. That keeps public browser
# bundles small. Do not switch this back to -fwasm-exceptions unless this
# wrapper grows real C++ catch sites; otherwise libcxxabi+libunwind adds
# ~32 KB gzip for no browser-visible benefit.
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
  -Wl,--export=cpp_msg_alloc
  -Wl,--export=cpp_msg_free
  -Wl,--export=cpp_msg_pack
  -Wl,--export=cpp_msg_unpack
  # cpp_msg_validate_single_segment exists in C++ for foreign-language
  # client use but is not exported in the slim wasm because no such
  # client lives in this repo yet (M6). The JS path uses pure-JS
  # validation. Re-export when/if M6 ships a Rust/Go demo that calls it.
  # M2: bump arena for slot message bytes. JS _acquireSlot tries the
  # arena first; on exhaustion or oversized requests, falls back to
  # cpp_msg_alloc. cpp_msg_arena_reset rewinds the cursor when JS
  # knows no live readers point into the arena.
  -Wl,--export=cpp_msg_arena_alloc
  -Wl,--export=cpp_msg_arena_reset
  -Wl,--export=cpp_msg_arena_capacity
  -Wl,--export=cpp_msg_arena_used
  # Auxiliary scratch buffer used by cpp_any_batch_read for the field
  # descriptor list. Production codegen reads cpp._auxPtr/_auxCap from
  # cpp_loader.mjs which caches these once at load time.
  -Wl,--export=cpp_scratch_aux_ptr
  -Wl,--export=cpp_scratch_aux_capacity
  # cpp_serialize_tape / cpp_deserialize_to_tape are only used by the
  # capnwasm/tape bench (capnweb-shape compatibility). Moved to bench
  # mode + we ship a separate tape-enabled wasm if/when needed.
  # Browser RPC/dynamic paths don't need them.
  -Wl,--export=cpp_any_open
  -Wl,--export=cpp_any_open_at
  -Wl,--export=cpp_any_set_reader_options
  -Wl,--export=cpp_any_reset_reader_options
  # M3: Native multi-reader slot pool. Each safe reader (openFoo) holds a
  # slot index; cpp_any_use_slot makes its slot active before any read.
  # acquire_slot copies bytes in and returns the slot index; release_slot
  # frees it (FinalizationRegistry calls this when the JS reader is GC'd).
  -Wl,--export=cpp_any_acquire_slot
  -Wl,--export=cpp_any_release_slot
  -Wl,--export=cpp_any_use_slot
  -Wl,--export=cpp_any_slot_data_ptr
  -Wl,--export=cpp_any_slot_msg_start
  -Wl,--export=cpp_any_slot_msg_end
  -Wl,--export=cpp_any_msg_start
  -Wl,--export=cpp_any_msg_end
  -Wl,--export=cpp_any_slot_reset_root
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
  # Cap-table index accessors. Codegen emits these for capability-typed
  # struct fields so the typed Reader can resolve the field through a
  # JS-side cap table, and the Builder can write a wire pointer that
  # carries the index of an outbound cap. Cap-table contents
  # (CapTarget proxies) live in JS; wasm just shuttles indexes.
  -Wl,--export=cpp_any_get_cap_index
  -Wl,--export=cpp_any_builder_set_cap_index
  -Wl,--export=cpp_any_int64_at
  -Wl,--export=cpp_any_uint32_at
  -Wl,--export=cpp_any_uint16_at
  -Wl,--export=cpp_any_uint8_at
  -Wl,--export=cpp_any_bool_at
  -Wl,--export=cpp_any_batch_read
  -Wl,--export=cpp_any_list_project
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
  # AnyPointer struct write paths. enter_struct/exit_struct covers
  # statically-typed nested struct fields; the two below cover the
  # case where the field is `:AnyPointer` (or an unbound generic slot)
  # so the type is unknown at codegen time and we just deep-copy from
  # an existing message (`set_struct_from_bytes`) or from another
  # live Reader's slot (`set_anypointer_from_slot`).
  -Wl,--export=cpp_any_builder_set_struct_from_bytes
  -Wl,--export=cpp_any_builder_set_anypointer_from_slot
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
  # Inbound Call params.capTable accessors (mirror return cap accessors)
  # — used by the call-handler path to build a typed cap-table for the
  # params Reader so capability-typed params fields resolve through it.
  -Wl,--export=cpp_rpc_get_call_cap_count
  -Wl,--export=cpp_rpc_get_call_cap_kind
  -Wl,--export=cpp_rpc_get_call_cap_id
  # Outbound capTable populator for Call.params or Return.results.
  # Reads packed uint32 export ids from cpp_in.
  -Wl,--export=cpp_rpc_set_outbound_cap_table
  -Wl,--export=cpp_rpc_begin_call
  -Wl,--export=cpp_rpc_begin_return
  -Wl,--export=cpp_rpc_finalize
  -Wl,--export=cpp_rpc_open_call_params
  -Wl,--export=cpp_rpc_open_return_results
  # Demo-only: server-side text-to-PNG renderer used by the public chat
  # demo's ChatRoom Durable Object (`src/chat_room.mjs`). The npm package
  # excludes `src/` so no published JS surface calls this; the Cloudflare
  # Worker that powers https://capnwasm.teamchong.net/chat builds from
  # this same wasm and does call it. Cost is small (~2 KB of wasm bytes
  # in the slim runtime) so we keep it in the slim build rather than
  # double-building. Revisit if slim wasm size becomes a real constraint.
  -Wl,--export=cpp_chat_render_text_png
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
    # cpp_any_builder_set_uint16 is the only set_<scalar> we keep in
    # bench mode. Codegen emits it for union-discriminant writes
    # (bin/capnwasm.mjs around line 1972). The other set_<scalar>
    # variants (set_bool / set_int64_lo_hi / set_struct_from_bytes /
    # set_uint8 / set_uint32) were intended as test-only paths after
    # JS switched to direct-memory writes via _dataPtr+offset, but
    # no test ever called them. Removed during M7 dead-code audit.
    -Wl,--export=cpp_any_builder_set_uint16
    # Tape codec — only used by the capnwasm/tape subpath (capnweb-shape
    # serialize/deserialize). The slim build doesn't ship it; the bench
    # build (used by tests + the inlined Node bundle) keeps it.
    -Wl,--export=cpp_serialize_tape
    -Wl,--export=cpp_deserialize_to_tape
  )
  WRAPPER+=("${WRAPPER_BENCH_ONLY[@]}")
fi

"$ZIG_BIN" c++ "${FLAGS[@]}" \
  "${KJ_SOURCES[@]}" \
  "${CAPNP_SOURCES[@]}" \
  "${WRAPPER[@]}" \
  -o "$OUT"

echo "Built: $OUT"
ls -la "$OUT"

# Strip + size-optimize.
OPT_OUT=zig-out/capnp_cpp.opt.wasm
wasm-opt "$OUT" \
  -Oz --converge \
  --strip-debug --strip-producers --strip-target-features \
  --enable-bulk-memory --enable-bulk-memory-opt \
  --enable-simd --enable-sign-ext --enable-nontrapping-float-to-int \
  --enable-exception-handling --enable-reference-types \
  -o "$OPT_OUT"
echo "Optimized: $OPT_OUT"
ls -la "$OPT_OUT"

# Two artifacts in dist/:
#   dist/capnp.slim.wasm  — production-only wasm (no test helpers),
#                           served by `import "capnwasm/browser"` as a
#                           separately-fetched asset
#   dist/inlined.mjs      — full wasm (with helpers) embedded in the
#                           single-file Node/Workers bundle, consumed by
#                           the default `import "capnwasm"`. Reads the
#                           full wasm from zig-out/ directly — never
#                           needs a copy in dist/.
#
# Building both requires two compilation passes (BENCH_MODE differs).
# A non-bench invocation produces capnp.slim.wasm and then recursively
# self-invokes in bench mode to produce dist/inlined.mjs from the full
# wasm.
if [ "$BENCH_MODE" = "1" ]; then
  node js/build_inlined.mjs   # writes dist/inlined.mjs
else
  cp "$OPT_OUT" dist/capnp.slim.wasm
  echo "[build.sh] building full bundle (for tests + default import)..."
  bash "$0" bench
fi
