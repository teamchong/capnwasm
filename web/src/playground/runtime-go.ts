// Go runtime for the playground globe demo.
//
// There is no AOT-compiled, browser-runnable Go interpreter we can ship
// at a reasonable bundle size today. Yaegi (Go interpreter written in
// Go) compiled to wasm exists in research forks but isn't a production-
// quality dep. The honest options are:
//
//   1. Server-side compile via a same-origin Worker (the user signed
//      off on this as the safety-first fallback). Not wired here yet.
//   2. A small in-browser shim: parse the Go function, transpile a
//      narrow subset to JS, run via native eval. That's what this file
//      does for now — enough for the SDK templates we ship and most
//      simple `format(response)` patterns the user will write.
//
// The shim handles (and only handles):
//   • `func format(<name> <type>) string { … }` declarations
//   • `return <expr>` with simple Go expressions that overlap JS
//   • `len(x)`, `fmt.Sprintf(...)` (mapped to template-literal-ish JS)
//   • field access via dot notation on `interface{}` / `map[string]any`
//
// Everything else falls through to a clear "Go shim couldn't transpile
// this" message in the status line so the user knows to simplify.

export function status(): string {
  return "go: in-browser shim (see status on errors)";
}

export async function load(): Promise<void> {
  // No external runtime to load.
}

export async function run(code: string, response: unknown): Promise<string> {
  // 1. Strip Go boilerplate that doesn't transpile.
  const cleaned = code
    .replace(/^\s*package\s+\w+\s*$/gm, "")
    .replace(/^\s*import\s*\([\s\S]*?\)\s*$/gm, "")
    .replace(/^\s*import\s+"[^"]+"\s*$/gm, "")
    .replace(/^\s*func\s+main\s*\(\)\s*\{[\s\S]*?\}\s*$/gm, "");
  // 2. Pluck out the format function body.
  const m = cleaned.match(/func\s+format\s*\(\s*(\w+)\s+[^)]*\)\s+string\s*\{([\s\S]*?)\}\s*$/m);
  if (!m) {
    return "go shim: couldn't find `func format(... ) string`. " +
           "The shim only runs this one shape. (Full Go via Worker fallback is queued.)";
  }
  const [, paramName, bodyRaw] = m;
  // 3. Light Go→JS body transpile.
  let body = bodyRaw
    // Go's := / var declarations → let
    .replace(/\b(\w+)\s*:=\s*/g, "let $1 = ")
    .replace(/\bvar\s+(\w+)\s+[\w\.\*\[\]]+\s*=\s*/g, "let $1 = ")
    // fmt.Sprintf("%s = %d", a, b) → `${a} = ${b}` (very narrow, but
    // good enough for the templates we emit). Fall back: leave it.
    .replace(/fmt\.Sprintf\(\s*"([^"]*)"\s*,([^)]*)\)/g, (_full, fmt, args) =>
      sprintfToTemplate(fmt, args)
    )
    // len(x) → x.length (for strings, slices, maps, arrays — close enough)
    .replace(/\blen\(\s*([^)]+?)\s*\)/g, "($1).length")
    // Go literal compare: "==" stays the same in JS for the simple cases
    // the format functions use.
    ;
  try {
    const fn = new Function(paramName, body);
    const out = fn(response);
    if (out == null) return "";
    return typeof out === "string" ? out : String(out);
  } catch (err) {
    return `go shim error: ${(err as Error).message}. ` +
           "The shim handles a narrow Go subset; complex logic needs the Worker fallback.";
  }
}

function sprintfToTemplate(fmt: string, argsExpr: string): string {
  const args = argsExpr.split(",").map((s) => s.trim()).filter(Boolean);
  let i = 0;
  // Replace each %v / %s / %d / %f / %T with `${args[i]}` in order. Any
  // verb we don't know becomes the bare arg.
  const tpl = fmt.replace(/%([vsdfTtq])/g, () => {
    const a = args[i++] ?? "undefined";
    return "${" + a + "}";
  });
  return "`" + tpl.replace(/`/g, "\\`") + "`";
}
