#!/bin/bash
# Build a wasm-EH-capable C++ exception runtime by compiling zig's vendored
# libcxxabi + libunwind sources with `-fwasm-exceptions`. Produces
# `zig-out/eh_runtime.a`, a static archive that cpp/build.sh +
# cpp/build_capnpc.sh link in alongside the rest of the wasm.
#
# Why we build this ourselves: zig ships its libc++/libcxxabi compiled
# `-fno-exceptions`, so its `__cxa_throw` is the no-op stub. Real
# exception handling on wasm requires the `-fwasm-exceptions` variant,
# which exists in zig's source tree but isn't prebuilt. We compile only
# the files that contain the exception machinery, leaving the rest of
# the C++ runtime to zig's auto-link.
#
# Why zig 0.17 specifically: zig 0.16's wasm-ld errors with "undefined
# tag symbol cannot be weak" on the `__cpp_exception` wasm tag. zig 0.17
# (currently 0.17.0-dev) auto-defines it. Set ZIG_BIN to point at a
# zig 0.17+ install; defaults to whichever `zig` is on PATH.
#
# Usage:  bash cpp/build_eh_runtime.sh
# Output: zig-out/eh_runtime.a

set -e
cd "$(dirname "$0")/.."

ZIG_BIN="${ZIG_BIN:-$(command -v zig || true)}"
if [ -z "$ZIG_BIN" ]; then
  echo "[build_eh_runtime.sh] error: zig not found on PATH and ZIG_BIN unset" >&2
  exit 1
fi
ZIG_VERSION=$("$ZIG_BIN" version)
case "$ZIG_VERSION" in
  0.16.*|0.15.*|0.14.*)
    echo "[build_eh_runtime.sh] warn: zig $ZIG_VERSION may not link the __cpp_exception" >&2
    echo "[build_eh_runtime.sh]       wasm tag. zig 0.17+ recommended; export ZIG_BIN" >&2
    echo "[build_eh_runtime.sh]       to point at a newer install if linking fails." >&2
    ;;
esac

ZIG_PREFIX="$(cd "$(dirname "$ZIG_BIN")/.." && pwd)"
# zig's bin/zig vs zig directly at root layout differ between
# distributions; fall back to the PATH-prefix-relative location.
if [ ! -d "$ZIG_PREFIX/lib/libcxxabi/src" ]; then
  ZIG_PREFIX="$(dirname "$ZIG_BIN")"
fi
ZIG_LIB="$ZIG_PREFIX/lib"
ZIG_LIBCXXABI="$ZIG_LIB/libcxxabi/src"
ZIG_LIBUNWIND="$ZIG_LIB/libunwind/src"
if [ ! -d "$ZIG_LIBCXXABI" ] || [ ! -d "$ZIG_LIBUNWIND" ]; then
  echo "[build_eh_runtime.sh] error: zig sysroot not found at $ZIG_LIB" >&2
  exit 1
fi

OUT=zig-out/eh_runtime
mkdir -p "$OUT"

# Patch cxa_personality.cpp to stub __cxa_call_unexpected. That function
# uses the deprecated dynamic-exception-spec EH path which still emits
# cleanupret IR the wasm backend can't lower. We replace its body with a
# terminate() call (it's only reachable from `void f() throw(int)`-style
# specs that C++17 removed).
PATCHED_CXA_PERS="$OUT/cxa_personality.cpp"
if [ ! -f "$PATCHED_CXA_PERS" ] || [ "$ZIG_LIBCXXABI/cxa_personality.cpp" -nt "$PATCHED_CXA_PERS" ]; then
  python3 - "$ZIG_LIBCXXABI/cxa_personality.cpp" "$PATCHED_CXA_PERS" <<'PYEOF'
import sys, re
src = open(sys.argv[1]).read()
m = re.search(r"__cxa_call_unexpected\(void\* arg\)\s*\{", src)
if not m:
    open(sys.argv[2], "w").write(src)
    sys.exit(0)
start = m.end() - 1
depth, i = 0, start
while i < len(src):
    if src[i] == "{": depth += 1
    elif src[i] == "}":
        depth -= 1
        if depth == 0: end = i + 1; break
    i += 1
patched = src[:start] + "{ (void)arg; std::terminate(); }" + src[end:]
open(sys.argv[2], "w").write(patched)
PYEOF
fi

# Compile each libcxxabi source with -fwasm-exceptions.
CXX_FLAGS=(
  -target wasm32-wasi-musl
  -fwasm-exceptions
  -mcpu=generic+exception_handling+reference_types
  -mexec-model=reactor
  -std=c++23
  -frtti
  -O2
  -fno-threadsafe-statics
  -D_LIBCXXABI_BUILDING_LIBRARY
  -D_LIBCPP_BUILDING_LIBRARY
  -DLIBCXXABI_USE_LLVM_UNWINDER
  -D_LIBCXXABI_HAS_NO_THREADS
  -D_LIBCPP_HAS_NO_THREADS
  -D_LIBUNWIND_IS_BAREMETAL
  -D__WASM_EXCEPTIONS__
  -I"$ZIG_LIBCXXABI"
  -I"$ZIG_LIB/libcxxabi/include"
  -I"$ZIG_LIB/libcxx/include"
  -I"$ZIG_LIB/libcxx/src"
  -I"$ZIG_LIB/libunwind/include"
  -I"$ZIG_LIB/libunwind/src"
)

# These provide the runtime symbols clang generates when emitting code
# under `-fwasm-exceptions`: __cxa_throw, __cxa_begin_catch,
# __cxa_end_catch, __gxx_personality_wasm0, __cxa_allocate_exception,
# typeinfo machinery for catch-by-type, and the terminate/unexpected
# handler defaults. We deliberately skip files like cxa_demangle (only
# needed for human-readable backtraces) and cxa_thread_atexit (no
# threads in our wasm).
SOURCES_CXX=(
  "$PATCHED_CXA_PERS"
  "$ZIG_LIBCXXABI/cxa_exception.cpp"
  "$ZIG_LIBCXXABI/cxa_exception_storage.cpp"
  "$ZIG_LIBCXXABI/cxa_handlers.cpp"
  "$ZIG_LIBCXXABI/cxa_default_handlers.cpp"
  "$ZIG_LIBCXXABI/cxa_aux_runtime.cpp"
  "$ZIG_LIBCXXABI/abort_message.cpp"
  "$ZIG_LIBCXXABI/fallback_malloc.cpp"
  "$ZIG_LIBCXXABI/private_typeinfo.cpp"
  "$ZIG_LIBCXXABI/stdlib_typeinfo.cpp"
  "$ZIG_LIBCXXABI/stdlib_exception.cpp"
)

OBJS=()
for src in "${SOURCES_CXX[@]}"; do
  obj="$OUT/$(basename "$src" .cpp).o"
  if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]; then
    "$ZIG_BIN" c++ "${CXX_FLAGS[@]}" -c "$src" -o "$obj"
  fi
  OBJS+=("$obj")
done

# Unwind-wasm.c — C, not C++. -fdeclspec lets the libunwind config
# header's __declspec(dllexport) attribute compile cleanly.
UNWIND_OBJ="$OUT/Unwind-wasm.o"
if [ ! -f "$UNWIND_OBJ" ] || [ "$ZIG_LIBUNWIND/Unwind-wasm.c" -nt "$UNWIND_OBJ" ]; then
  "$ZIG_BIN" cc \
    -target wasm32-wasi-musl \
    -fwasm-exceptions \
    -mcpu=generic+exception_handling+reference_types \
    -O2 -fdeclspec \
    -D_LIBUNWIND_IS_BAREMETAL \
    -D_LIBUNWIND_IS_NATIVE_ONLY \
    -D__WASM_EXCEPTIONS__ \
    -I"$ZIG_LIB/libunwind/include" \
    -I"$ZIG_LIBUNWIND" \
    -c "$ZIG_LIBUNWIND/Unwind-wasm.c" \
    -o "$UNWIND_OBJ"
fi
OBJS+=("$UNWIND_OBJ")

# `__cpp_exception` wasm tag definition. The tag is referenced by every
# throw/catch site emitted under `-fwasm-exceptions` but neither libcxxabi
# nor libunwind defines it; LLVM's upstream compiler-rt would, but zig
# doesn't bundle that file. Inline assembly here lets the rest of the
# toolchain link cleanly.
TAG_OBJ="$OUT/eh_tag.o"
if [ ! -f "$TAG_OBJ" ] || [ cpp/eh_tag.s -nt "$TAG_OBJ" ]; then
  "$ZIG_BIN" cc \
    -target wasm32-wasi-musl \
    -c cpp/eh_tag.s \
    -o "$TAG_OBJ"
fi
OBJS+=("$TAG_OBJ")

# Pack into a static archive. `zig ar` is wasm-LLD-aware so the resulting
# .a can be passed straight to a downstream `zig c++` link without
# host-arch confusion.
AR_OUT=zig-out/eh_runtime.a
"$ZIG_BIN" ar rcs "$AR_OUT" "${OBJS[@]}"
echo "Built: $AR_OUT ($(ls -la "$AR_OUT" | awk '{print $5}') bytes)"
