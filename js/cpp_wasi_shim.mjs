// Browser-side polyfill for the five wasi_snapshot_preview1 imports that the
// C++ capnproto build pulls in. Browsers don't expose WASI natively; this
// supplies just enough to satisfy the linker and forward stderr writes.

export function buildWasiImports({ memory } = {}) {
  let mem;
  function setMemory(m) { mem = m; }

  function readBytes(ptr, len) {
    return new Uint8Array(mem.buffer, ptr, len);
  }

  function writeUint32(ptr, value) {
    new DataView(mem.buffer).setUint32(ptr, value, true);
  }

  return {
    setMemory,
    imports: {
      // No CLI args in the browser.
      args_get(_argv_ptr, _argv_buf_ptr) { return 0; },
      args_sizes_get(argc_ptr, argv_buf_size_ptr) {
        writeUint32(argc_ptr, 0);
        writeUint32(argv_buf_size_ptr, 0);
        return 0;
      },

      // fd_write writes scatter-gather iovecs to a file descriptor. Forward
      // stderr (fd=2) and stdout (fd=1) to console; ignore everything else.
      fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
        let total = 0;
        const dv = new DataView(mem.buffer);
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

      // proc_exit: terminate. The C++ side calls this on unrecoverable
      // errors. Throw a JS error so the calling code can catch it.
      proc_exit(code) {
        throw new Error(`capnp_cpp: proc_exit(${code})`);
      },

      // fd_close: not used in our flow but referenced from libc init paths.
      fd_close(_fd) { return 0; },
    },
  };
}
