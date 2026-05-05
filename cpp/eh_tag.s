## Defines the `__cpp_exception` wasm tag that LLVM's `-fwasm-exceptions`
## codegen references at every throw / catch site. Without this, the
## linker errors with "undefined tag symbol cannot be weak".
##
## The tag carries one i32 payload (the exception object pointer). zig's
## libcxxabi sources reference the tag but don't define it; LLVM's
## upstream compiler-rt has a definition in `compiler-rt/lib/builtins/wasm/eh.S`
## that zig doesn't bundle. We provide the definition here so the rest
## of the toolchain Just Works without requiring users to pull in
## compiler-rt's wasm/eh.S separately.
##
## Built into the same archive as the libcxxabi+libunwind sources by
## cpp/build_eh_runtime.sh.

	.text
	.globl	__cpp_exception
	.tagtype	__cpp_exception i32
__cpp_exception:
