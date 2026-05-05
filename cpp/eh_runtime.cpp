// Itanium C++ ABI exception entry points that zig's libc++abi build for
// wasm32-wasi-musl deliberately omits (it links cxa_noexception.o instead of
// cxa_exception.o). KJ requires C++ exceptions to compile but, in our
// serialize/deserialize use, the throw paths only fire on malformed input.
//
// Why trap-on-throw instead of real C++ exceptions through wasm-EH?
//
// EARLIER WRITE-UP CLAIMED THIS WAS BLOCKED ON LLVM 21'S WASM BACKEND
// FAILING TO SELECT `cleanupret`. THAT WAS WRONG. The cleanupret backend
// error fires only when the wasm CPU/feature mix doesn't include the
// exception-handling proposal. Adding
//   -mcpu=generic+exception_handling+reference_types
// makes LLVM 21 (shipped with zig 0.16) compile `-fwasm-exceptions`
// IR cleanly, including throws of objects with non-trivial destructors.
// Verified end-to-end with `throw kj::Exception(...)` on 2025-05.
//
// What actually keeps real wasm-EH out of capnwasm today is the
// integration work:
//
//   1. Build zig's libcxxabi sources (~12 .cpp files) with `-fwasm-exceptions`
//      and link them into our wasm. These are vendored at
//      $ZIG_LIB/libcxxabi/src; one file (cxa_personality.cpp) needs a
//      patch to stub `__cxa_call_unexpected`'s body (the deprecated-EH
//      branch the wasm backend can't lower).
//   2. Compile zig's libunwind/src/Unwind-wasm.c for the
//      `__wasm_lpad_context` / `_Unwind_CallPersonality` runtime helpers.
//   3. Provide the `__cpp_exception` wasm tag. zig 0.17's wasm-ld
//      auto-defines it; zig 0.16's wasm-ld errors out with
//      "undefined tag symbol cannot be weak", so a switch to zig 0.17
//      (or a manual tag-def assembly file) is required.
//   4. Disable zig's automatic libc++/libcxxabi link with -nostdlib++
//      since our locally-built variant would otherwise duplicate-define
//      handler/typeinfo symbols.
//   5. Wire the resulting EH-capable wasm into the existing build
//      pipeline without breaking the slim/inlined/web outputs.
//
// All five steps are well-defined; estimated effort 1–2 days of focused
// build-system work. They land as a follow-up batch when prioritized.
//
// Until then we keep the trap-on-throw model: the compiler emits
// __cxa_throw / __cxa_begin_catch references, our stubs map them to wasm
// `unreachable` traps, and JS catches the resulting RuntimeError.
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
