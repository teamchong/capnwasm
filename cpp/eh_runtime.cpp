// Itanium C++ ABI exception entry points that zig's libc++abi build for
// wasm32-wasi-musl deliberately omits (it links cxa_noexception.o instead of
// cxa_exception.o). KJ requires C++ exceptions to compile but, in our
// serialize/deserialize use, the throw paths only fire on malformed input.
//
// Why not real C++ exceptions on wasm?
//
// LLVM 21 (shipped with zig 0.16) supports `-fwasm-exceptions` and emits
// `try_table` opcodes for catch blocks, but the wasm backend's cleanup-pad
// lowering can't select `cleanupret` when the thrown value has a non-trivial
// destructor (the canonical case: `throw kj::Exception(...)` or
// `throw std::runtime_error(...)`). Verified with a minimal repro on
// 2025-05; the backend prints
//   `fatal error: error in backend: Cannot select: cleanupret`
// and aborts. Trivially-destructible exception types (raw int, pointer,
// POD struct) lower fine.
//
// Until LLVM fixes the wasm-EH cleanupret lowering, we keep the
// trap-on-throw model: the compiler emits __cxa_throw / __cxa_begin_catch
// references, our stubs map them to wasm `unreachable` traps, and JS
// catches the resulting RuntimeError. Switching to real EH is then a
// one-line build flip (`-fexceptions` -> `-fwasm-exceptions`) plus
// linking zig's libcxxabi+libunwind sources (which exist as source under
// `$ZIG_LIB/libcxxabi/src` and `$ZIG_LIB/libunwind/src/Unwind-wasm.c`).
//
// We use `__builtin_trap()` instead of `std::terminate()` because the
// libc++abi terminate handler prints "libc++abi: terminating" to stderr
// before aborting. JS already catches the wasm trap as a RuntimeError;
// the stderr noise just clutters test output. `__builtin_trap` lowers to
// a clean wasm `unreachable` opcode, no fd_write to stderr.
//
// Reference: https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html
//            https://github.com/llvm/llvm-project/blob/main/libcxxabi/src/cxa_noexception.cpp

#include <cstdlib>
#include <cstddef>
#include <new>
#include <exception>

extern "C" {

// (kj/debug.c++ used to reference strerror_r; now patched at build time
// to inline an empty-string assignment instead, so the libc symbol is
// dead and --gc-sections drops the errno-name table. See cpp/build.sh.)

// Allocate space for the thrown exception object. The Itanium ABI requires
// a small header before the user data; libc++abi reserves space for
// __cxa_exception there. Since the throw stub traps and never reads the
// header, plain malloc is sufficient.
void* __cxa_allocate_exception(std::size_t size) noexcept {
  return std::malloc(size);
}

void __cxa_free_exception(void* thrown) noexcept {
  std::free(thrown);
}

// The Itanium ABI says __cxa_throw never returns. Trap directly so JS
// observes a clean wasm RuntimeError("unreachable") and the libc++abi
// terminate handler's stderr message is bypassed.
[[noreturn]] void __cxa_throw(void*, void*, void (*)(void*)) noexcept {
  __builtin_trap();
}

[[noreturn]] void __cxa_rethrow() noexcept {
  __builtin_trap();
}

// Catch handlers won't ever execute because we never resume from a throw.
// These exist only because the compiler emits references to them in catch
// blocks compiled with -fexceptions.
[[noreturn]] void* __cxa_begin_catch(void*) noexcept {
  __builtin_trap();
}

void __cxa_end_catch() noexcept {}

}  // extern "C"
