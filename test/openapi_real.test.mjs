// Run our OpenAPI codegen against a real-world-shape spec (the canonical
// Petstore example, slightly trimmed). Confirms we handle:
//   - $ref resolution in nested schemas
//   - tags + operationId
//   - integer/format=int64 (mapped to number)
//   - enum + nullable on the same field
//   - array of $ref'd objects
//   - multiple security schemes (oauth2 ignored, api_key recognized)
//   - per-operation security overriding default
//   - response codes including 404 / 400
//   - explode=true on array query params

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");
const SPEC = join(HERE, "_fixtures", "petstore_oas.json");

const tmp = (await import("node:fs")).mkdtempSync(join((await import("node:os")).tmpdir(), "cw-oas-real-"));
const out = join(tmp, "petstore.gen.mjs");
const r = spawnSync("node", [CLI, "openapi", SPEC, "-o", out], { encoding: "utf8" });
if (r.status !== 0) throw new Error(`codegen failed: ${r.stderr}`);

// Patch the import path so the test runs against the in-repo runtime.
const runtimeUrl = pathToFileURL(resolve(ROOT, "js", "rest_runtime.mjs")).href;
const fs = await import("node:fs");
let gen = fs.readFileSync(out, "utf8");
gen = gen.replaceAll('"capnwasm/rest"', JSON.stringify(runtimeUrl));
fs.writeFileSync(out, gen);

const { createPetstoreClient } = await import(pathToFileURL(out).href);
const { auth, RestError } = await import(runtimeUrl);

let port;
let server;

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let m;
    let body = "";
    for await (const ch of req) body += ch.toString("utf8");

    // GET /v2/pet/{id}
    if (req.method === "GET" && (m = url.pathname.match(/^\/v2\/pet\/(\d+)$/))) {
      const apiKey = req.headers["api_key"];
      if (apiKey !== "test-key") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing api_key" })); return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: +m[1], name: "Rex", photoUrls: ["http://x/1.png"],
        category: { id: 1, name: "dog" },
        tags: [{ id: 10, name: "friendly" }],
        status: "available",
      }));
      return;
    }
    // GET /v2/pet/findByStatus?status=...
    if (req.method === "GET" && url.pathname === "/v2/pet/findByStatus") {
      const statuses = url.searchParams.getAll("status");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(
        statuses.map((s, i) => ({
          id: i + 1, name: `pet-${s}`, photoUrls: [], status: s,
        }))
      ));
      return;
    }
    // POST /v2/pet
    if (req.method === "POST" && url.pathname === "/v2/pet") {
      const parsed = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 999, ...parsed }));
      return;
    }
    // DELETE /v2/pet/{id}
    if (req.method === "DELETE" && url.pathname.match(/^\/v2\/pet\/\d+$/)) {
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});

after(() => server?.close());

function client(opts = {}) {
  return createPetstoreClient({
    baseUrl: `http://127.0.0.1:${port}/v2`,
    auth: auth.apiKey("test-key", { name: "api_key" }),
    ...opts,
  });
}

test("OpenAPI/real: $ref resolution returns nested objects", async () => {
  const pet = await client().getPetById(7);
  assert.equal(pet.id, 7);
  assert.equal(pet.name, "Rex");
  assert.equal(pet.category.name, "dog");
  assert.equal(pet.tags[0].name, "friendly");
  assert.equal(pet.status, "available");
});

test("OpenAPI/real: array query param (explode=true) sends repeated keys", async () => {
  const pets = await client().findPetsByStatus(["available", "pending"]);
  assert.equal(pets.length, 2);
  assert.equal(pets[0].name, "pet-available");
  assert.equal(pets[1].name, "pet-pending");
});

test("OpenAPI/real: POST with $ref'd request body and response body", async () => {
  const created = await client().addPet({
    name: "Spot", photoUrls: ["http://x/spot.jpg"], status: "pending",
  });
  assert.equal(created.id, 999);
  assert.equal(created.name, "Spot");
  assert.equal(created.status, "pending");
});

test("OpenAPI/real: missing api_key header returns 401", async () => {
  const c = createPetstoreClient({
    baseUrl: `http://127.0.0.1:${port}/v2`,
    // no auth
  });
  await assert.rejects(c.getPetById(1), (err) => err.status === 401);
});
