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

      // Additional WASI imports the schema compiler pulls in (filesystem,
      // env, time, random). All return success / sensible defaults — the
      // compiler operates in pure-memory mode through our virtual file
      // table; no real I/O is required.
      environ_get(_env_ptr, _env_buf_ptr) { return 0; },
      environ_sizes_get(envc_ptr, envbuf_size_ptr) {
        writeUint32(envc_ptr, 0);
        writeUint32(envbuf_size_ptr, 0);
        return 0;
      },
      clock_time_get(_id, _precision, time_ptr) {
        // Return current ns since epoch as i64 little-endian.
        const ns = BigInt(Date.now()) * 1_000_000n;
        const dv = new DataView(mem.buffer);
        dv.setBigUint64(time_ptr, ns, true);
        return 0;
      },
      random_get(buf_ptr, buf_len) {
        const out = readBytes(buf_ptr, buf_len);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
          // crypto.getRandomValues caps at 65536 bytes per call.
          for (let off = 0; off < buf_len; off += 65536) {
            crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, buf_len)));
          }
        } else {
          for (let i = 0; i < buf_len; i++) out[i] = (Math.random() * 256) & 0xff;
        }
        return 0;
      },
      // Filesystem: the compiler uses a virtual in-memory filesystem provided
      // by our wrapper; these wasi imports get called only on init paths
      // libc walks (e.g. probing whether stdout is a terminal). Return ENOSYS.
      fd_seek(_fd, _offset, _whence, _newoffset_ptr) { return 8; /* EBADF */ },
      fd_read(_fd, _iovs_ptr, _iovs_len, _nread_ptr) { return 8; },
      fd_fdstat_get(_fd, _stat_ptr) { return 8; },
      fd_fdstat_set_flags(_fd, _flags) { return 8; },
      fd_prestat_get(_fd, _prestat_ptr) { return 8; },
      fd_prestat_dir_name(_fd, _path_ptr, _path_len) { return 8; },
      path_open() { return 8; },
      path_filestat_get() { return 8; },
      path_create_directory() { return 8; },
      path_remove_directory() { return 8; },
      path_unlink_file() { return 8; },
      path_rename() { return 8; },
      path_readlink() { return 8; },
      path_symlink() { return 8; },
      path_link() { return 8; },
      poll_oneoff() { return 8; },
      sched_yield() { return 0; },
    },
  };
}
