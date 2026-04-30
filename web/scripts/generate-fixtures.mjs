// Pre-generate fixture data the playground fetches at runtime. Both the
// JSON (REST baseline) and the Cap'n Proto bytes ship as static assets so
// neither path pays any server-side encoding cost — the bench measures
// just network transfer + client decode + render.
//
// Workload: N separate /data/user-i.{json,capnp} files. Real list views
// usually fetch records individually so they can render rows as they
// arrive; this matches that shape.

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { load } from "../../dist/inlined.mjs";
import { buildUser } from "../src/playground/users.gen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "..", "public", "data");
await mkdir(PUBLIC, { recursive: true });

const COUNT = 200;
const cpp = await load();

let totalJsonRaw = 0, totalJsonGz = 0;
let totalCapnpRaw = 0, totalCapnpGz = 0;

for (let i = 0; i < COUNT; i++) {
  const id = i + 1;
  const user = {
    id,
    name: `user-${id.toString().padStart(6, "0")}`,
    email: `user-${id}@example.com`,
    joinedAtMs: 1700000000000 + i * 60_000,
    active: i % 3 !== 0,
    avatar: new Uint8Array(Array.from({ length: 32 }, (_, j) => (i * 7 + j * 13) & 0xff)),
  };

  // JSON form
  const jsonText = JSON.stringify({
    ...user,
    avatar: Buffer.from(user.avatar).toString("base64"),
  });
  await writeFile(resolve(PUBLIC, `user-${id}.json`), jsonText);
  totalJsonRaw += jsonText.length;
  totalJsonGz += gzipSync(jsonText, { level: 6 }).length;

  // Cap'n Proto form
  const b = buildUser(cpp);
  b.id = BigInt(user.id);
  b.name = user.name;
  b.email = user.email;
  b.joinedAtMs = BigInt(user.joinedAtMs);
  b.active = user.active;
  b.avatar = user.avatar;
  const bytes = b.toBytes();
  await writeFile(resolve(PUBLIC, `user-${id}.capnp`), bytes);
  totalCapnpRaw += bytes.length;
  totalCapnpGz += gzipSync(bytes, { level: 6 }).length;
}

console.log(`Generated ${COUNT} user records:`);
console.log(`  JSON:  ${totalJsonRaw} B raw  ${totalJsonGz} B gz   (avg ${(totalJsonRaw / COUNT).toFixed(0)} B/record)`);
console.log(`  capnp: ${totalCapnpRaw} B raw  ${totalCapnpGz} B gz   (avg ${(totalCapnpRaw / COUNT).toFixed(0)} B/record)`);
console.log(`  ratio (raw): capnp is ${(totalJsonRaw / totalCapnpRaw).toFixed(2)}x smaller`);
console.log(`  ratio (gz):  capnp is ${(totalJsonGz / totalCapnpGz).toFixed(2)}x smaller`);
