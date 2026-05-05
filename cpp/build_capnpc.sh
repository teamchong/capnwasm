#!/bin/bash
# Build the capnp schema COMPILER (lex + parse + node-translate + emit
# CodeGeneratorRequest) statically linked into wasm via zig cc. Produces
# zig-out/capnpc.wasm — JS uses this to compile .capnp source to a binary
# CodeGeneratorRequest, then walks the result via schema.capnp Reader to
# build our codegen model. No external capnp binary needed; version
# guaranteed to match the runtime since both come from the same vendor/.

set -e
cd "$(dirname "$0")/.."

CAPNP_SRC=cpp/vendor
OUT=zig-out/capnpc.wasm
mkdir -p zig-out

# kj sources — same as runtime + parse/char (for the compiler's parser combinators).
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
  "$CAPNP_SRC/kj/mutex.c++"
  "$CAPNP_SRC/kj/arena.c++"
  "$CAPNP_SRC/kj/table.c++"
  "$CAPNP_SRC/kj/list.c++"
  "$CAPNP_SRC/kj/refcount.c++"
  "$CAPNP_SRC/kj/parse/char.c++"
  "$CAPNP_SRC/kj/string-tree.c++"
  "$CAPNP_SRC/kj/filesystem.c++"
  "$CAPNP_SRC/kj/io.c++"
)

# capnp runtime sources — superset of what we ship in the runtime, since
# the compiler uses dynamic reflection internally.
CAPNP_SOURCES=(
  "$CAPNP_SRC/capnp/c++.capnp.c++"
  "$CAPNP_SRC/capnp/blob.c++"
  "$CAPNP_SRC/capnp/arena.c++"
  "$CAPNP_SRC/capnp/layout.c++"
  "$CAPNP_SRC/capnp/any.c++"
  "$CAPNP_SRC/capnp/message.c++"
  "$CAPNP_SRC/capnp/serialize.c++"
  "$CAPNP_SRC/capnp/list.c++"
  "$CAPNP_SRC/capnp/stream.capnp.c++"
  "$CAPNP_SRC/capnp/schema.capnp.c++"
  "$CAPNP_SRC/capnp/schema.c++"
  "$CAPNP_SRC/capnp/schema-loader.c++"
  "$CAPNP_SRC/capnp/dynamic.c++"
  "$CAPNP_SRC/capnp/stringify.c++"
)

# Compiler sources — lex, parse, node-translate, generics, type-id.
COMPILER_SOURCES=(
  "$CAPNP_SRC/capnp/compiler/lexer.capnp.c++"
  "$CAPNP_SRC/capnp/compiler/grammar.capnp.c++"
  "$CAPNP_SRC/capnp/compiler/lexer.c++"
  "$CAPNP_SRC/capnp/compiler/parser.c++"
  "$CAPNP_SRC/capnp/compiler/node-translator.c++"
  "$CAPNP_SRC/capnp/compiler/generics.c++"
  "$CAPNP_SRC/capnp/compiler/type-id.c++"
  "$CAPNP_SRC/capnp/compiler/error-reporter.c++"
  "$CAPNP_SRC/capnp/compiler/compiler.c++"
)

WRAPPER=(
  cpp/capnpc_wrapper.cpp
)

# Locate zig. Real wasm-EH requires zig 0.17+; see cpp/build.sh for
# the rationale. Resolution order: ZIG_BIN, .capnwasm-zig symlink,
# zig on PATH.
if [ -z "${ZIG_BIN:-}" ]; then
  if [ -x ".capnwasm-zig/zig" ]; then
    ZIG_BIN="$(cd .capnwasm-zig && pwd)/zig"
  else
    ZIG_BIN="$(command -v zig || true)"
  fi
fi
if [ -z "$ZIG_BIN" ]; then
  echo "[build_capnpc.sh] error: zig not found." >&2
  echo "[build_capnpc.sh]        Run: bash scripts/install-zig-eh.sh" >&2
  exit 1
fi
ZIG_VERSION_STR="$("$ZIG_BIN" version)"
case "$ZIG_VERSION_STR" in
  0.16.*|0.15.*|0.14.*|0.13.*)
    echo "[build_capnpc.sh] error: zig $ZIG_VERSION_STR can't link the __cpp_exception wasm tag." >&2
    echo "[build_capnpc.sh]        Run: bash scripts/install-zig-eh.sh" >&2
    exit 1
    ;;
esac

# Build the EH runtime archive (idempotent — reuses cached .o files).
ZIG_BIN="$ZIG_BIN" bash cpp/build_eh_runtime.sh

FLAGS=(
  -target wasm32-wasi-musl
  -Oz
  -std=c++23
  -fwasm-exceptions
  -mcpu=generic+exception_handling+reference_types
  -frtti
  -fno-threadsafe-statics
  -fno-stack-protector
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -fdata-sections
  -ffunction-sections
  # -flto removed: with LTO + zig's auto-linked libcxxabi.a (which
  # provides cxa_noexception.o = no-op __cxa_throw stub), our
  # locally-built cxa_exception.o (real __cxa_throw + wasm-EH) gets
  # silently dropped during LTO module merging. Without LTO the
  # ordinary archive resolution picks our .o first since it's passed
  # as a direct input file.
  -fmerge-all-constants
  -D_WASI_EMULATED_SIGNAL
  -D_WASI_EMULATED_MMAN
  -DKJ_USE_MAIN=0
  -DKJ_NO_LIBDL=1
  -DNDEBUG
  -DKJ_NO_STACK_TRACES_IN_RELEASE=1
  -I"$CAPNP_SRC"
  -Icpp
  -Wno-deprecated
  -Wno-unused-parameter
  -Wno-unknown-pragmas
  -Wl,--no-entry
  -Wl,--export-dynamic
  -Wl,--export=capnpc_in_ptr
  -Wl,--export=capnpc_out_ptr
  -Wl,--export=capnpc_in_capacity
  -Wl,--export=capnpc_out_capacity
  -Wl,--export=capnpc_reset
  -Wl,--export=capnpc_add_file
  -Wl,--export=capnpc_compile
  -Wl,--export=capnpc_get_errors
  -Wl,--export=capnpc_extract_structs
  -Wl,--export=capnpc_extract_interfaces
  -lwasi-emulated-signal
  -lwasi-emulated-mman
  -Wl,--gc-sections
  -Wl,--strip-all
)

"$ZIG_BIN" c++ "${FLAGS[@]}" \
  "${KJ_SOURCES[@]}" \
  "${CAPNP_SOURCES[@]}" \
  "${COMPILER_SOURCES[@]}" \
  "${WRAPPER[@]}" \
  zig-out/eh_runtime/cxa_exception.o \
  zig-out/eh_runtime/cxa_personality.o \
  zig-out/eh_runtime/Unwind-wasm.o \
  zig-out/eh_runtime/eh_tag.o \
  -o "$OUT"

echo "Built: $OUT"
ls -la "$OUT"

OPT_OUT=zig-out/capnpc.opt.wasm
wasm-opt "$OUT" \
  -Oz --converge \
  --strip-debug --strip-producers --strip-target-features \
  --enable-bulk-memory --enable-bulk-memory-opt \
  --enable-simd --enable-sign-ext --enable-nontrapping-float-to-int \
  --enable-exception-handling --enable-reference-types \
  -o "$OPT_OUT"
echo "Optimized: $OPT_OUT"
ls -la "$OPT_OUT"

# Ship the compiler in dist/ as gzipped bytes — capnpc_loader.mjs gunzips
# on load. Saves ~460 KB unpacked vs the raw .wasm; gzip is universal,
# and the CLI is the only consumer (load happens once per `gen` call).
mkdir -p dist
# -n omits the original filename + mtime from the gzip header, which
# would otherwise change every build and produce non-byte-identical
# dist/ artifacts. The CI build-wasm workflow asserts byte-identity
# against the committed copy, so determinism here matters.
gzip -9nc "$OPT_OUT" > dist/capnpc.wasm.gz
echo "Compressed to: dist/capnpc.wasm.gz"
ls -la dist/capnpc.wasm.gz
# Remove any stale uncompressed file from earlier builds.
rm -f dist/capnpc.wasm
