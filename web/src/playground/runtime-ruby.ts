// Ruby runtime for the playground globe demo.
//
// Loads ruby.wasm 3.3 (a real upstream Ruby VM compiled to wasi32) on
// first Ruby tab use. The CDN bundle is ~10 MB; lazy-loaded so it only
// pays a cost when the user actually opens the Ruby tab.
//
// Convention matches runtime-python.ts: the user defines a `format`
// method taking the response (a Hash) and returning a string. If they
// don't, anything they `puts` lands in the bubble.

let rubyVm: any = null;
let rubyLoading: Promise<any> | null = null;
let rubyError: Error | null = null;

// ruby.wasm ships in two npm packages:
//   • @ruby/wasm-wasi      — the JS bindings + DefaultRubyVM
//   • @ruby/3.3-wasm-wasi  — the actual ruby+stdlib.wasm (per-version)
// The bindings package alone has no wasm to load.
const CDN_BINDINGS = "@ruby/wasm-wasi@2.7.1";
const CDN_RUBY     = "@ruby/3.3-wasm-wasi@2.7.1";
const CDN_BROWSER  = `https://cdn.jsdelivr.net/npm/${CDN_BINDINGS}/dist/browser/+esm`;
const CDN_WASM     = `https://cdn.jsdelivr.net/npm/${CDN_RUBY}/dist/ruby+stdlib.wasm`;

export function status(): string {
  if (rubyError)   return `ruby failed: ${rubyError.message}`;
  if (rubyVm)      return "ruby ready";
  if (rubyLoading) return "loading ruby (~10 MB)…";
  return "ruby not loaded";
}

export async function load(): Promise<void> {
  if (rubyVm) return;
  if (rubyLoading) { await rubyLoading; return; }
  rubyLoading = (async () => {
    const mod = await import(/* @vite-ignore */ CDN_BROWSER);
    // The browser bundle exposes DefaultRubyVM(wasmModule) where the
    // wasm module itself is fetched from the same package.
    const wasmRes = await fetch(CDN_WASM);
    if (!wasmRes.ok) throw new Error(`ruby wasm fetch failed (${wasmRes.status})`);
    const wasmBytes = await wasmRes.arrayBuffer();
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const { vm } = await mod.DefaultRubyVM(wasmModule, {
      // Keep ruby quiet by default; we capture stdout via __cw_capture
      // below instead of letting it land in the host console.
    });
    rubyVm = vm;
  })();
  try {
    await rubyLoading;
  } catch (err) {
    rubyError = err as Error;
    throw err;
  } finally {
    rubyLoading = null;
  }
}

export async function run(code: string, response: unknown): Promise<string> {
  if (!rubyVm) await load();
  const respJson = JSON.stringify(response ?? null);
  // Wrap the user's code so we can:
  //   • parse `response` from JSON  •expose `__cw_capture` as the stdout sink
  //   • invoke `format(response)` if defined; otherwise echo whatever was
  //     written via `puts` / `print`.
  const wrapper = `
require "json"
response = JSON.parse(${rubyStringLiteral(respJson)})
__cw_buf = String.new
$stdout = StringIO.new(__cw_buf)
$stderr = StringIO.new(__cw_buf)
begin
${indent(code, 2)}
rescue => __cw_e
  __cw_buf << "ruby error: #{__cw_e.class}: #{__cw_e.message}"
end
__cw_out =
  if defined?(format) && method(:format).is_a?(Method)
    begin
      format(response)
    rescue => __cw_e2
      "ruby format error: #{__cw_e2.class}: #{__cw_e2.message}"
    end
  else
    __cw_buf
  end
__cw_out.to_s
`;
  try {
    const result = rubyVm.eval(wrapper);
    return String(result.toString()).trimEnd();
  } catch (err) {
    return `ruby error: ${(err as Error).message}`;
  }
}

function rubyStringLiteral(s: string): string {
  // Build a Ruby double-quoted string with proper escaping for any
  // backslash, double-quote, dollar (interpolation) or hash (also
  // interpolation). Newlines become \n; everything else passes through.
  return '"' + s.replace(/[\\"#$\n\r]/g, (c) =>
    c === "\\" ? "\\\\" :
    c === '"'  ? '\\"'  :
    c === "#"  ? "\\#"  :
    c === "$"  ? "\\$"  :
    c === "\n" ? "\\n"  :
    c === "\r" ? "\\r"  : c) + '"';
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => pad + l).join("\n");
}
