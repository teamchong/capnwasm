#!/usr/bin/env node
// Minify each subpath JS module via esbuild, write to dist/. Imports
// stay as relative ESM paths so the minified files cross-reference each
// other within dist/. Esbuild's per-file minify mode (no bundling)
// preserves tree-shakability for downstream bundlers.
//
// What gets minified: every js/*.mjs that's exposed via package.json
// exports (rpc, client, typed, http_batch, http_stream, postmessage,
// browser, dynamic, stream, tape_serializer, rest_runtime). The inlined
// entry (dist/inlined.mjs) is built by build_inlined.mjs and stays a
// separate, already-large bundle that includes base64-encoded wasm.
//
// Output: dist/<name>.mjs (minified) + dist/<name>.mjs.map (source map).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import * as esbuild from "esbuild";
import { minify as terserMinify } from "terser";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JS_DIR = resolve(ROOT, "js");
const DIST_DIR = resolve(ROOT, "dist");

// Modules to minify. Each becomes dist/<name>.mjs. Picked to match the
// subpath exports in package.json so production users get the small
// version, and dev consumers can still browse js/ for source.
const MODULES = [
  "rpc.mjs",
  "client.mjs",
  "typed.mjs",
  "http_batch.mjs",
  "http_stream.mjs",
  "postmessage.mjs",
  "browser.mjs",
  "cpp_loader.mjs",        // imported by browser.mjs
  "dynamic.mjs",
  "rest_runtime.mjs",
  "reconnect.mjs",         // optional: auto-reconnect helper
  "router.mjs",            // optional: federation gateway
];

await mkdir(DIST_DIR, { recursive: true });

let totalRaw = 0, totalGz = 0, totalBr = 0;
// Source files in js/ reach into ../dist/inlined.mjs via the relative
// path that's correct from THERE. After minification the file lives in
// dist/, so the same import needs to be ./inlined.mjs. Same for any
// other ../dist/* paths.
function rewriteImports(src) {
  return src
    .replace(/from\s+["']\.\.\/dist\/([^"']+)["']/g, 'from "./$1"');
}

// Two-stage minification: esbuild first (handles modern syntax + emits a
// sourcemap), then terser as a second pass on the esbuild output (better
// at byte-level squeezing. Variable renaming, dead-branch elimination,
// constant folding). On our modules terser shaves another ~400 bytes gz
// on top of esbuild alone, mostly on rpc.mjs and http_batch.mjs where
// repeated property access patterns get folded harder.
//
// Side-step: where terser DOESN'T help (or makes things worse. Happens
// occasionally on tiny modules like client.mjs where terser's headers
// outweigh its compression), we fall back to esbuild's output.
for (const mod of MODULES) {
  const original = await readFile(resolve(JS_DIR, mod), "utf8");
  const src = rewriteImports(original);
  // esbuild handles top-level await + private class fields + everything
  // we use. Keep ES2022 to preserve those. Older targets force
  // helper-function expansion that can BLOAT minified output.
  const esbuildResult = await esbuild.transform(src, {
    minify: true,
    target: "es2022",
    format: "esm",
    loader: "js",
    sourcemap: "external",
    sourcefile: mod,
  });

  let code = esbuildResult.code;
  let map  = esbuildResult.map;
  // Second pass via terser. Compare gzipped sizes; keep whichever wins.
  try {
    const terserResult = await terserMinify(esbuildResult.code, {
      module: true,
      compress: { passes: 3 },
      mangle: true,
      ecma: 2022,
      sourceMap: { content: esbuildResult.map },
    });
    if (terserResult.code) {
      const gzEsb = gzipSync(esbuildResult.code, { level: 9 }).length;
      const gzTer = gzipSync(terserResult.code, { level: 9 }).length;
      if (gzTer < gzEsb) {
        code = terserResult.code;
        if (terserResult.map) map = String(terserResult.map);
      }
    }
  } catch {
    // Terser failed. Keep esbuild's output. Doesn't fail the build.
  }

  const outPath = resolve(DIST_DIR, mod);
  await writeFile(outPath, code);
  await writeFile(outPath + ".map", map);

  const raw = Buffer.byteLength(code, "utf8");
  const gz = gzipSync(code, { level: 9 }).length;
  const br = brotliCompressSync(code).length;
  totalRaw += raw; totalGz += gz; totalBr += br;
  console.log(`  ${mod.padEnd(22)} raw=${String(raw).padStart(6)}  gz=${String(gz).padStart(5)}  br=${String(br).padStart(5)}`);
}

console.log(`  ${"TOTAL".padEnd(22)} raw=${String(totalRaw).padStart(6)}  gz=${String(totalGz).padStart(5)}  br=${String(totalBr).padStart(5)}`);

// Pre-compress the slim wasm so static-asset hosts (Cloudflare, S3 + CF
// in front, GitHub Pages with a custom 404-handler) can serve the
// already-compressed bytes without paying brotli encode per-request.
// Both .br and .gz so Accept-Encoding negotiation can pick whichever the
// client supports.
const slimWasmPath = resolve(DIST_DIR, "capnp.slim.wasm");
try {
  const slim = await readFile(slimWasmPath);
  const slimBr = brotliCompressSync(slim);
  const slimGz = gzipSync(slim, { level: 9 });
  await writeFile(slimWasmPath + ".br", slimBr);
  await writeFile(slimWasmPath + ".gz", slimGz);
  console.log(`  capnp.slim.wasm.br      ${slimBr.length} B`);
  console.log(`  capnp.slim.wasm.gz      ${slimGz.length} B`);
} catch (err) {
  // Slim wasm may not exist yet on a fresh checkout. Fine, build:wasm
  // produces it. Just skip pre-compression in that case.
  if (err.code !== "ENOENT") throw err;
}
