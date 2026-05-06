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

const CDN_URL = "https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.25.0/micropython.mjs";

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
    // The CDN URL returns an ES module. Vite leaves /* @vite-ignore */
    // dynamic imports alone, so the network fetch happens at runtime
    // only when the Python tab is opened.
    const mod = await import(/* @vite-ignore */ CDN_URL);
    const factory = mod.default ?? mod.loadMicroPython ?? mod;
    if (typeof factory !== "function") {
      throw new Error("micropython module did not export a factory function");
    }
    let captured = "";
    mpInstance = await factory({
      stdout: (text: string) => { captured += text; },
      // Capture stderr alongside stdout so Python tracebacks land in
      // the bubble too.
      stderr: (text: string) => { captured += text; },
      url: CDN_URL.replace(/\.mjs$/, ".wasm"),
    });
    // Stash the capture buffer on the instance so run() can read+reset
    // it without rebuilding the whole runtime.
    mpInstance.__captureRef = { get: () => captured, reset: () => { captured = ""; } };
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
  const cap = py.__captureRef;
  cap.reset();

  // Pass the response as a JSON string the user code parses with
  // `json.loads`. Marshaling a 2.9 MB nested object via JS↔Python proxy
  // is slow; JSON is plenty fast for the demo's payload sizes.
  const respJson = JSON.stringify(response ?? null);
  // Two-stage exec:
  //   1. inject `response` global from JSON.
  //   2. run the user's code (which may define `format`).
  //   3. if `format` exists, call it; the result is the bubble text.
  //   4. otherwise return whatever was printed.
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
  // Try to call `format(response)` if it's defined.
  let formatted: string | null = null;
  try {
    py.runPython(
      "if 'format' in dir():\n" +
      "    __cw_out = format(response)\n" +
      "    if __cw_out is None: __cw_out = ''\n" +
      "    if not isinstance(__cw_out, str): __cw_out = str(__cw_out)\n" +
      "    print('\\u0000__cw_marker__\\u0000' + __cw_out)\n"
    );
    const captured = cap.get();
    const marker = "\u0000__cw_marker__\u0000";
    const idx = captured.lastIndexOf(marker);
    if (idx >= 0) formatted = captured.slice(idx + marker.length).trimEnd();
  } catch (err) {
    return `python format error: ${(err as Error).message}`;
  }
  if (formatted !== null) return formatted;
  // Fall back to print()-captured output.
  return cap.get().trimEnd();
}
