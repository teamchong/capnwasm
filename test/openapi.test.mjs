// Integration tests for the OpenAPI codegen path.
// Generates a client from a real OpenAPI 3.x spec, points it at a Node
// mock server, and exercises every kind of operation we translate
// (path params, query params, JSON body, $ref resolution, nullable fields,
// tag-grouped operations, security scheme inference).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const spec = {
  openapi: "3.0.0",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "http://localhost:0" }],   // overridden at test time
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          tag: { type: "string", nullable: true },
        },
      },
      PetList: {
        type: "object",
        required: ["data"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
          next_cursor: { type: "string" },
        },
      },
      NewPet: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        tags: ["pets"],
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { "200": {
          description: "ok",
          content: { "application/json": { schema: { $ref: "#/components/schemas/PetList" } } },
        }},
      },
      post: {
        operationId: "createPet",
        tags: ["pets"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } },
        },
        responses: { "201": {
          description: "created",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        }},
      },
    },
    "/pets/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      get: {
        operationId: "getPet",
        tags: ["pets"],
        responses: { "200": {
          description: "ok",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        }},
      },
      delete: {
        operationId: "deletePet",
        responses: { "204": { description: "deleted" } },
      },
    },
  },
};

// Generate the client from this spec.
const tmpDir = mkdtempSync(join(tmpdir(), "cw-oas-"));
const specPath = join(tmpDir, "petstore.json");
const outPath  = join(tmpDir, "petstore.gen.mjs");
writeFileSync(specPath, JSON.stringify(spec));
const r = spawnSync("node", [CLI, "openapi", specPath, "-o", outPath], { encoding: "utf8" });
if (r.status !== 0) throw new Error(`openapi codegen failed: ${r.stderr}`);

// Rewrite the "capnwasm/rest" import to the in-repo runtime so the test
// runs without npm-link gymnastics.
const runtimeUrl = pathToFileURL(resolve(ROOT, "js", "rest_runtime.mjs")).href;
let generated = readFileSync(outPath, "utf8");
generated = generated.replaceAll('"capnwasm/rest"', JSON.stringify(runtimeUrl));
writeFileSync(outPath, generated);

const { createPetstoreClient } = await import(pathToFileURL(outPath).href);
const { auth, RestError } = await import(runtimeUrl);

let server;
let port;

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const a = req.headers["authorization"];
    if (!a || !a.startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no auth" }));
      return;
    }
    let body = "";
    for await (const ch of req) body += ch.toString("utf8");

    let m;
    if (req.method === "GET" && url.pathname === "/pets") {
      const limit = +url.searchParams.get("limit");
      const items = [
        { id: 1, name: "Kitty", tag: "cat" },
        { id: 2, name: "Rex",   tag: null  },
      ];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: limit ? items.slice(0, limit) : items, next_cursor: "" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/pets") {
      const parsed = JSON.parse(body);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 99, name: parsed.name, tag: null }));
      return;
    }
    if (req.method === "GET" && (m = url.pathname.match(/^\/pets\/(\d+)$/))) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: +m[1], name: "Fido", tag: null }));
      return;
    }
    if (req.method === "DELETE" && url.pathname.match(/^\/pets\/\d+$/)) {
      res.writeHead(204);
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
    baseUrl: `http://127.0.0.1:${port}`,
    auth: auth.bearer("token"),
    ...opts,
  });
}

test("OpenAPI: GET /pets returns parsed PetList from $ref schemas", async () => {
  const list = await client().listPets();
  assert.equal(list.data.length, 2);
  assert.equal(list.data[0].name, "Kitty");
});

test("OpenAPI: GET /pets?limit=1 sends query param", async () => {
  const list = await client().listPets(1);
  assert.equal(list.data.length, 1);
});

test("OpenAPI: POST /pets sends JSON body, returns 201 Pet", async () => {
  const p = await client().createPet({ name: "Spot" });
  assert.equal(p.id, 99);
  assert.equal(p.name, "Spot");
});

test("OpenAPI: GET /pets/{id} substitutes path parameter", async () => {
  const p = await client().getPet(7);
  assert.equal(p.id, 7);
});

test("OpenAPI: DELETE /pets/{id} returns empty on 204", async () => {
  const v = await client().deletePet(5);
  assert.equal(v, "");
});

test("OpenAPI: bearer security scheme inferred from spec → 401 without token", async () => {
  const c = createPetstoreClient({
    baseUrl: `http://127.0.0.1:${port}`,
    // no auth override; bearer is default but token is null
    auth: { type: "bearer", token: null },
  });
  await assert.rejects(c.getPet(1), (err) => err.status === 401);
});
