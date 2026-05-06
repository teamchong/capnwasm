// Python runtime for the playground globe demo.
//
// Loads micropython-webassembly (~250 KB gz) lazily on first Python
// tab use. Provides:
//
//   await load()                       // bootstrap, called on tab switch
//   await run(code, response)          // execute user code, return string
//   status()                           // human-readable status line
//
// The user's `format(response)` function is what we call. Whatever
// `format` returns is stringified and returned to the caller for the
// bubble. If `format` isn't defined, we capture stdout from `print()`
// instead so the user can write a top-level script that just calls
// `print(...)` and have that bubble out.
//
// micropython.wasm itself has no filesystem / network / OS access, so
// running arbitrary user-typed Python is safe at the JS-host boundary.

let mpInstance: any = null;
let mpLoading: Promise<any> | null = null;
let mpError: Error | null = null;
let captureBuf = "";

export function status(): string {
  if (mpError)  return `micropython failed: ${mpError.message}`;
  if (mpInstance) return "micropython ready";
  if (mpLoading) return "loading micropython…";
  return "micropython not loaded";
}

export async function load(): Promise<void> {
  if (mpInstance) return;
  if (mpLoading) { await mpLoading; return; }
  mpLoading = (async () => {
    // Vite resolves @micropython from node_modules and lazy-chunks the
    // import so the Python runtime only ships when this function runs.
    // The package's named `loadMicroPython` export wraps Emscripten's
    // lower-level Module factory and returns the high-level instance
    // with `.runPython()` / `.runPythonAsync()` / `.globals`.
    const [mod, wasmUrl] = await Promise.all([
      import("@micropython/micropython-webassembly-pyscript"),
      // ?url tells Vite to ship the wasm as a fingerprinted asset and
      // give us back the URL string. Without it the loader looks for
      // /assets/micropython.wasm next to the JS chunk and 404s.
      // @ts-ignore — Vite-only specifier
      import("@micropython/micropython-webassembly-pyscript/micropython.wasm?url"),
    ]);
    const loadMicroPython = (mod as any).loadMicroPython
      ?? (mod as any).default?.loadMicroPython;
    if (typeof loadMicroPython !== "function") {
      throw new Error("micropython package didn't expose loadMicroPython");
    }
    mpInstance = await loadMicroPython({
      stdout: (text: string) => { captureBuf += text + "\n"; },
      stderr: (text: string) => { captureBuf += text + "\n"; },
      url: (wasmUrl as any).default,
    });
  })();
  try {
    await mpLoading;
  } catch (err) {
    mpError = err as Error;
    throw err;
  } finally {
    mpLoading = null;
  }
}

/**
 * Run the user's Python source against the given mock response.
 *
 * Convention: the user defines `format(response)` returning a string.
 * If they don't, anything they `print()` is captured and returned.
 */
export async function run(code: string, response: unknown): Promise<string> {
  if (!mpInstance) await load();
  const py = mpInstance;
  captureBuf = "";

  // Pass the response as a JSON string the user code parses with
  // `json.loads`. Marshaling a 2.9 MB nested object via JS↔Python proxy
  // is slow; JSON is plenty fast for the demo's payload sizes.
  const respJson = JSON.stringify(response ?? null);
  // Two-stage exec:
  //   1. inject `response` global from JSON.
  //   2. run the user's code (which may define `format`).
  //   3. if `format` exists, call it; print the result with a marker
  //      so we can pluck it out of the captured stdout buffer.
  //   4. otherwise fall back to whatever was printed normally.
  const wrapper =
    "import json as __cw_json\n" +
    `response = __cw_json.loads(${JSON.stringify(respJson)})\n`;
  try {
    py.runPython(wrapper);
  } catch (err) {
    return `python init error: ${(err as Error).message}`;
  }
  try {
    py.runPython(code);
  } catch (err) {
    return `python error: ${(err as Error).message}`;
  }
  let formatted: string | null = null;
  try {
    py.runPython(
      "if 'format' in dir():\n" +
      "    __cw_out = format(response)\n" +
      "    if __cw_out is None: __cw_out = ''\n" +
      "    if not isinstance(__cw_out, str): __cw_out = str(__cw_out)\n" +
      "    print('\\u0000__cw_marker__\\u0000' + __cw_out)\n"
    );
    const marker = "\u0000__cw_marker__\u0000";
    const idx = captureBuf.lastIndexOf(marker);
    if (idx >= 0) formatted = captureBuf.slice(idx + marker.length).trimEnd();
  } catch (err) {
    return `python format error: ${(err as Error).message}`;
  }
  if (formatted !== null) return formatted;
  // Fall back to print()-captured output.
  return captureBuf.trimEnd();
}
