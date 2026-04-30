// Itanium C++ ABI exception entry points that zig's libc++abi build for
// wasm32-wasi-musl deliberately omits (it links cxa_noexception.o instead of
// cxa_exception.o). KJ requires C++ exceptions to compile but, in our
// serialize/deserialize use, the throw paths only fire on malformed input.
//
// These definitions follow the no-exceptions semantics documented for
// libc++abi when EH is disabled at runtime: throwing terminates the program.
//
// Reference: https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html
//            https://github.com/llvm/llvm-project/blob/main/libcxxabi/src/cxa_noexception.cpp

#include <cstdlib>
#include <new>
#include <exception>

extern "C" {

// Allocate space for the thrown exception object. The Itanium ABI requires
// a small header before the user data; libc++abi reserves space for
// __cxa_exception there. Since we always terminate on throw and never read
// the header, plain malloc is sufficient.
void* __cxa_allocate_exception(std::size_t size) noexcept {
  return std::malloc(size);
}

void __cxa_free_exception(void* thrown) noexcept {
  std::free(thrown);
}

// The Itanium ABI says __cxa_throw never returns. With no unwinder available
// in wasm32-wasi-musl, the only legal action is to terminate.
[[noreturn]] void __cxa_throw(void*, void*, void (*)(void*)) noexcept {
  std::terminate();
}

[[noreturn]] void __cxa_rethrow() noexcept {
  std::terminate();
}

// Catch handlers won't ever execute because we never resume from a throw.
// These exist only because the compiler emits references to them in catch
// blocks compiled with -fexceptions.
void* __cxa_begin_catch(void*) noexcept {
  std::terminate();
}

void __cxa_end_catch() noexcept {}

}  // extern "C"
