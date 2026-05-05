// Minimal Itanium C++ ABI exception entry points for the browser/runtime wasm.
//
// The runtime wrapper does not catch C++ exceptions. Its defensive JS/C++
// validation keeps normal public paths away from KJ throw sites; malformed
// fallback paths may still throw, in which case terminating the wasm call is
// acceptable and much smaller than linking libcxxabi + libunwind into the
// browser artifact. The schema compiler wasm (`capnpc.wasm`) is different:
// it catches kj::Exception and still links the real wasm-EH runtime.

#include <cstdlib>
#include <cstddef>
#include <exception>

extern "C" {

void* __cxa_allocate_exception(std::size_t size) noexcept {
  return std::malloc(size);
}

void __cxa_free_exception(void* thrown) noexcept {
  std::free(thrown);
}

[[noreturn]] void __cxa_throw(void*, void*, void (*)(void*)) noexcept {
  std::terminate();
}

[[noreturn]] void __cxa_rethrow() noexcept {
  std::terminate();
}

void* __cxa_begin_catch(void*) noexcept {
  std::terminate();
}

void __cxa_end_catch() noexcept {}

}  // extern "C"
