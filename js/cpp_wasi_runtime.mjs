// Minimal wasi_snapshot_preview1 polyfill for the capnp runtime wasm.
// The runtime declares only 5 wasi imports — args, fd_write, proc_exit,
// fd_close. Keeping this separate from the full schema-compiler shim
// lets RPC-only browser bundles ship just the bytes they need.

export function makeMemRefs() {
  let mem;
  return {
    setMemory(m) { mem = m; },
    readBytes(ptr, len) { return new Uint8Array(mem.buffer, ptr, len); },
    writeUint32(ptr, value) { new DataView(mem.buffer).setUint32(ptr, value, true); },
    dvFor() { return new DataView(mem.buffer); },
  };
}

export function runtimeImports({ readBytes, writeUint32, dvFor }) {
  return {
    args_get(_argv_ptr, _argv_buf_ptr) { return 0; },
    args_sizes_get(argc_ptr, argv_buf_size_ptr) {
      writeUint32(argc_ptr, 0);
      writeUint32(argv_buf_size_ptr, 0);
      return 0;
    },
    // fd_write forwards stdout (fd=1) and stderr (fd=2) to console.
    // Other fds get the byte count back so the caller treats it as a
    // successful no-op write.
    fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
      let total = 0;
      const dv = dvFor();
      for (let i = 0; i < iovs_len; i++) {
        const ptr = dv.getUint32(iovs_ptr + i * 8, true);
        const len = dv.getUint32(iovs_ptr + i * 8 + 4, true);
        if (fd === 1 || fd === 2) {
          const text = new TextDecoder().decode(readBytes(ptr, len));
          (fd === 2 ? console.error : console.log)(text.replace(/\n$/, ""));
        }
        total += len;
      }
      writeUint32(nwritten_ptr, total);
      return 0;
    },
    proc_exit(code) { throw new Error(`capnp_cpp: proc_exit(${code})`); },
    fd_close(_fd) { return 0; },
  };
}

/** Just the 5 imports the runtime wasm declares. */
export function buildRuntimeWasiImports() {
  const refs = makeMemRefs();
  return { setMemory: refs.setMemory, imports: runtimeImports(refs) };
}
