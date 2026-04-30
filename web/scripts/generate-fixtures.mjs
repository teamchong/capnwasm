// Pre-generate fixture data the playground fetches at runtime. Both the
// JSON (REST baseline) and the Cap'n Proto bytes ship as static assets so
// neither path pays any server-side encoding cost — the bench measures
// just network transfer + client decode + render.
//
// Two workloads, picked to show the honest tradeoff:
//   small/  — 200 user records with a 32 B avatar. JSON wins on decode
//             time because each record is tiny and JSON.parse is V8-
//             internal C++; the wasm boundary cost shows up here.
//   blob/   — 50 user records with a 4 KB avatar each. JSON has to
//             base64-encode the avatar (+33% wire) and decode it back;
//             capnwasm ships the raw bytes. Capnwasm wins.

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { load } from "../../dist/inlined.mjs";
import { buildUser } from "../src/playground/users.gen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "..", "public", "data");

const cpp = await load();

async function emit(workload, count, avatarBytes) {
  const dir = resolve(PUBLIC, workload);
  await mkdir(dir, { recursive: true });

  let totalJsonRaw = 0, totalJsonGz = 0;
  let totalCapnpRaw = 0, totalCapnpGz = 0;

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
  console.log(`  JSON:  ${totalJsonRaw} B raw  ${totalJsonGz} B gz   (avg ${(totalJsonRaw / count).toFixed(0)} B/record)`);
  console.log(`  capnp: ${totalCapnpRaw} B raw  ${totalCapnpGz} B gz   (avg ${(totalCapnpRaw / count).toFixed(0)} B/record)`);
  console.log(`  ratio (raw): capnp ${(totalJsonRaw / totalCapnpRaw).toFixed(2)}x smaller`);
  console.log(`  ratio (gz):  capnp ${(totalJsonGz / totalCapnpGz).toFixed(2)}x smaller`);
}

await emit("small", 200, 32);
await emit("blob",  50,  4096);
console.log(`Wrote fixtures to ${PUBLIC}`);
