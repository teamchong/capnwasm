// Pre-generate fixture data the playground fetches at runtime. All three
// formats; JSON (REST baseline), capnweb's wire format, and Cap'n Proto
// bytes; ship as static assets so neither path pays any server-side
// encoding cost. The bench measures network transfer + client decode +
// render only.
//
// Two workloads, picked to show the tradeoff:
//   small/ ; 200 user records with a 32 B avatar. JSON wins on decode
//             time because each record is tiny and JSON.parse is V8-
//             internal C++; the wasm boundary cost shows up here.
//   blob/  ; 50 user records with a 4 KB avatar each. JSON has to
//             base64-encode the avatar (+33% wire) and decode it back;
//             capnwasm ships the raw bytes. Capnwasm wins.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { load } from "../../dist/inlined.mjs";
import { buildUser } from "../src/playground/users.capnp.gen.mjs";
import { serialize as cwbSerialize } from "capnweb";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "..", "public", "data");

const cpp = await load();

async function emit(workload, count, avatarBytes) {
  const dir = resolve(PUBLIC, workload);
  await mkdir(dir, { recursive: true });

  let totalJsonRaw = 0,  totalJsonGz = 0;
  let totalCapnpRaw = 0, totalCapnpGz = 0;
  let totalCwbRaw = 0,   totalCwbGz = 0;

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const avatar = new Uint8Array(avatarBytes);
    for (let j = 0; j < avatarBytes; j++) avatar[j] = (i * 7 + j * 13) & 0xff;
    const user = {
      id,
      name: `user-${id.toString().padStart(6, "0")}`,
      email: `user-${id}@example.com`,
      joinedAtMs: 1700000000000 + i * 60_000,
      active: i % 3 !== 0,
      avatar,
    };

    const jsonText = JSON.stringify({
      ...user,
      avatar: Buffer.from(user.avatar).toString("base64"),
    });
    await writeFile(resolve(dir, `user-${id}.json`), jsonText);
    totalJsonRaw += jsonText.length;
    totalJsonGz += gzipSync(jsonText, { level: 6 }).length;

    // capnweb wire format; JSON-shaped with typed-value escapes
    // (Uint8Array becomes ["bytes", "<base64>"]). serialize returns a
    // string we ship verbatim.
    const cwbText = cwbSerialize(user);
    await writeFile(resolve(dir, `user-${id}.cwb`), cwbText);
    totalCwbRaw += cwbText.length;
    totalCwbGz += gzipSync(cwbText, { level: 6 }).length;

    const b = buildUser(cpp);
    b.id = BigInt(user.id);
    b.name = user.name;
    b.email = user.email;
    b.joinedAtMs = BigInt(user.joinedAtMs);
    b.active = user.active;
    b.avatar = user.avatar;
    const bytes = b.toBytes();
    await writeFile(resolve(dir, `user-${id}.capnp`), bytes);
    totalCapnpRaw += bytes.length;
    totalCapnpGz += gzipSync(bytes, { level: 6 }).length;
  }

  console.log(`[${workload}] ${count} records, ${avatarBytes} B avatar:`);
  console.log(`  JSON:    ${totalJsonRaw} B raw  ${totalJsonGz} B gz   (avg ${(totalJsonRaw / count).toFixed(0)} B/record)`);
  console.log(`  capnweb: ${totalCwbRaw} B raw  ${totalCwbGz} B gz   (avg ${(totalCwbRaw / count).toFixed(0)} B/record)`);
  console.log(`  capnp:   ${totalCapnpRaw} B raw  ${totalCapnpGz} B gz   (avg ${(totalCapnpRaw / count).toFixed(0)} B/record)`);
  console.log(`  ratio raw vs JSON: capnweb ${(totalJsonRaw / totalCwbRaw).toFixed(2)}x  capnp ${(totalJsonRaw / totalCapnpRaw).toFixed(2)}x`);
  console.log(`  ratio gz  vs JSON: capnweb ${(totalJsonGz / totalCwbGz).toFixed(2)}x  capnp ${(totalJsonGz / totalCapnpGz).toFixed(2)}x`);
  return {
    count,
    avatarBytes,
    raw: { json: totalJsonRaw, capnweb: totalCwbRaw, capnp: totalCapnpRaw },
    gzip: { json: totalJsonGz, capnweb: totalCwbGz, capnp: totalCapnpGz },
    ratios: {
      jsonToCapnpGzip: totalJsonGz / totalCapnpGz,
      capnwebToCapnpGzip: totalCwbGz / totalCapnpGz,
    },
  };
}

const small = await emit("small", 200, 32);
const blob = await emit("blob",  50,  4096);

async function gzipSize(path) {
  return gzipSync(await readFile(path), { level: 9 }).length;
}

const root = resolve(HERE, "..", "..");

// Three bundle shapes for the homepage / docs to surface separately.
//
//   reader: js/reader.mjs + cpp_loader + capnp.reader.wasm — what a consumer
//           of capnwasm responses ships when they only project responses
//           via draft() and never build their own messages or open RPC.
//   browser: js/browser.mjs + cpp_loader + capnp.slim.wasm — adds the full
//            wasm (builder + RPC + lazy reader + tape codec).
//   rpc: browser bundle + the RPC client JS.
const cppLoaderGzip = await gzipSize(resolve(root, "dist", "cpp_loader.mjs"));
const capnwasmReaderGzip =
  await gzipSize(resolve(root, "js", "reader.mjs")) +
  cppLoaderGzip +
  await gzipSize(resolve(root, "dist", "capnp.reader.wasm"));
const capnwasmBrowserGzip =
  await gzipSize(resolve(root, "dist", "browser.mjs")) +
  await gzipSize(resolve(root, "dist", "capnp.slim.wasm"));
const capnwasmRpcGzip =
  capnwasmBrowserGzip +
  await gzipSize(resolve(root, "dist", "rpc.mjs"));
const capnwebGzip = await gzipSize(resolve(root, "web", "node_modules", "capnweb", "dist", "index.js"));

const metricsDir = resolve(HERE, "..", "public", "metrics");
await mkdir(metricsDir, { recursive: true });
await writeFile(resolve(metricsDir, "build.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "web/scripts/generate-fixtures.mjs",
  fixtures: { small, blob },
  bundles: {
    gzip: {
      capnwasmReader: capnwasmReaderGzip,
      capnwasmBrowser: capnwasmBrowserGzip,
      capnwasmRpc: capnwasmRpcGzip,
      capnweb: capnwebGzip,
    },
    ratios: {
      capnwasmReaderToCapnweb: capnwasmReaderGzip / capnwebGzip,
      capnwasmRpcToCapnweb: capnwasmRpcGzip / capnwebGzip,
    },
  },
}, null, 2) + "\n");

console.log(`Wrote fixtures to ${PUBLIC}`);
