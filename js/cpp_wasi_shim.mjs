// Browser-side polyfill for the wasi_snapshot_preview1 imports the C++
// schema compiler wasm pulls in. Browsers don't expose WASI natively;
// this supplies just enough to satisfy the linker and forward stderr
// writes.
//
// The runtime wasm only declares 5 imports (args, fd_write, proc_exit,
// fd_close) — those live in cpp_wasi_runtime.mjs so the runtime loader
// stays small and bundlers don't drag the full shim into RPC-only
// browser bundles.

import { buildRuntimeWasiImports, makeMemRefs, runtimeImports } from "./cpp_wasi_runtime.mjs";

export { buildRuntimeWasiImports };

export function buildWasiImports() {
  const refs = makeMemRefs();
  const { setMemory, readBytes, writeUint32 } = refs;
  return {
    setMemory,
    imports: {
      ...runtimeImports(refs),

      // ---- Compiler-only imports (capnpc.opt.wasm) -------------------
      environ_get(_env_ptr, _env_buf_ptr) { return 0; },
      environ_sizes_get(envc_ptr, envbuf_size_ptr) {
        writeUint32(envc_ptr, 0);
        writeUint32(envbuf_size_ptr, 0);
        return 0;
      },
      clock_time_get(_id, _precision, time_ptr) {
        const ns = BigInt(Date.now()) * 1_000_000n;
        refs.dvFor().setBigUint64(time_ptr, ns, true);
        return 0;
      },
      random_get(buf_ptr, buf_len) {
        const out = readBytes(buf_ptr, buf_len);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
          for (let off = 0; off < buf_len; off += 65536) {
            crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, buf_len)));
          }
        } else {
          for (let i = 0; i < buf_len; i++) out[i] = (Math.random() * 256) & 0xff;
        }
        return 0;
      },
      // Filesystem: the compiler uses a virtual in-memory filesystem
      // provided by our wrapper; these wasi imports get called only on
      // init paths libc walks (e.g. probing whether stdout is a terminal).
      // Return ENOSYS / EBADF as appropriate.
      fd_seek(_fd, _offset, _whence, _newoffset_ptr) { return 8; },
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
