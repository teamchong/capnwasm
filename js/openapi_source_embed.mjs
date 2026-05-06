// Embed the verbatim OpenAPI source bytes into a .capnp file as a
// gzip+base64 comment block. Cap'n Proto's text format treats `#` as a
// line comment, so the embed is invisible to `capnp compile` but
// recoverable by capnwasm's text parser. This is what makes
// `convert openapi.json → .capnp → openapi.json` byte-identical.
//
// Marker layout:
//
//   # capnwasm-openapi-source-begin v=1 encoding=gzip+base64
//   # H4sIAAAA...                            (base64, line-wrapped)
//   # ...
//   # capnwasm-openapi-source-end
//
// Why gzip:
//   • OpenAPI JSON is ~90 % redundant under base64; without compression a
//     9 MB spec would balloon the .capnp file by ~12 MB.
//   • With gzip (default level 6) the same 9 MB JSON ships as ~1.3 MB of
//     base64, so the .capnp file grows by roughly 25 % instead of 220 %.
//
// Why a comment, not a capnp annotation:
//   • The wasm-side capnp compiler has a fixed scratch budget and chokes
//     on multi-MB string-typed annotation values.
//   • Comments survive every capnp tool unchanged (compile, format, lint).
//   • The reverse-direction recovery path is plain text scanning; no
//     dependency on a successful capnp compile.
//
// Runtime support:
//   • Node 14+ via `node:zlib` (the only path the CLI ever hits today).
//   • Browser support is intentionally not provided yet; callers in the
//     browser bundle import this module dynamically and tolerate failure
//     so a missing zlib doesn't break their parse path.

import { gzipSync, gunzipSync } from "node:zlib";

const BEGIN = "# capnwasm-openapi-source-begin v=1 encoding=gzip+base64";
const END   = "# capnwasm-openapi-source-end";
// 76 chars matches the historical MIME quoted-base64 width and keeps the
// embedded block readable in editors that wrap long lines.
const LINE_WIDTH = 76;

/**
 * Render an embedded source block from the original UTF-8 text.
 *
 * @param {string} text  - verbatim OpenAPI JSON (or YAML) source bytes
 * @returns {string} the marker block, ready to prepend / inject into the
 *   .capnp text. Always ends with a trailing newline.
 */
export function embedOpenapiSource(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const gz = gzipSync(Buffer.from(text, "utf8"));
  const b64 = gz.toString("base64");
  const lines = [BEGIN];
  for (let i = 0; i < b64.length; i += LINE_WIDTH) {
    lines.push("# " + b64.slice(i, i + LINE_WIDTH));
  }
  lines.push(END);
  return lines.join("\n") + "\n";
}

/**
 * Recover the embedded source text from a .capnp file. Returns `null`
 * when no marker is present or the embed is malformed.
 *
 * @param {string} capnpText  - full .capnp file as text
 * @returns {string|null}     - the original bytes, or null
 */
export function extractOpenapiSource(capnpText) {
  if (typeof capnpText !== "string") return null;
  const beginIdx = capnpText.indexOf(BEGIN);
  if (beginIdx < 0) return null;
  const endIdx = capnpText.indexOf(END, beginIdx + BEGIN.length);
  if (endIdx < 0) return null;
  // Body lies between the BEGIN line and the END line; strip the comment
  // prefix `# ` from each line and concatenate. Whitespace-only lines and
  // stray indentation are tolerated.
  const body = capnpText.slice(beginIdx + BEGIN.length, endIdx);
  const b64 = body
    .split("\n")
    .map((l) => l.replace(/^\s*#\s?/, "").trim())
    .filter((l) => l.length > 0)
    .join("");
  if (b64.length === 0) return null;
  try {
    const gz = Buffer.from(b64, "base64");
    return gunzipSync(gz).toString("utf8");
  } catch {
    return null;
  }
}
