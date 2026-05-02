// Integration tests for the @rest CLI codegen + js/rest_runtime.mjs.
// Spins up a tiny Node http mock server, points a generated client at it,
// and asserts on every supported feature: path params, query, headers,
// body encodings, auth, retries, cancellation, pagination, error shapes.

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

// ---- Generate a client from a small TS schema -------------------------
const schemaSrc = `
interface Item {
  id: number;
  name: string;
  tags: string[];
}
interface ItemList {
  data: Item[];
  next_cursor: string;
}
interface CreateItemParams {
  name: string;
  status?: string;
}
interface UploadResult {
  id: string;
  size: number;
}

// @rest baseUrl=http://localhost:0
// @auth bearer
// @retries count=2 backoff=linear baseDelay=10
interface TestAPI {
  // @get /items/{id}
  getItem(id: number): Promise<Item>;

  // @get /items
  // @query limit
  // @query status
  listItems(limit?: number, status?: string): Promise<ItemList>;

  // @get /items
  // @paginated cursor=after items=data next=next_cursor
  // @query status
  streamItems(status?: string): AsyncIterable<Item>;

  // @post /items
  // @body body
  createItem(body: CreateItemParams): Promise<Item>;

  // @put /items/{id}
  // @body body
  updateItem(id: number, body: CreateItemParams): Promise<Item>;

  // @delete /items/{id}
  deleteItem(id: number): Promise<void>;

  // @get /items/{id}/raw
  // @decode arrayBuffer
  getItemRaw(id: number): Promise<ArrayBuffer>;

  // @post /upload
  // @bodyencoding multipart
  // @body form
  upload(form: FormData): Promise<UploadResult>;

  // @get /search
  // @query q
  // @header X-Trace-Id traceId
  search(q: string, traceId?: string): Promise<Item[]>;

  // @get /flaky
  flaky(): Promise<{ ok: boolean }>;

  // @get /slow
  slow(): Promise<{ ok: boolean }>;

  // @get /error
  error(): Promise<unknown>;
}
`;

const tmpDir = mkdtempSync(join(tmpdir(), "cw-rest-"));
writeFileSync(join(tmpDir, "test_api.ts"), schemaSrc);
const outPath = join(tmpDir, "test_api.gen.mjs");
const r = spawnSync("node", [CLI, "gen", join(tmpDir, "test_api.ts"), "-o", outPath], { encoding: "utf8" });
if (r.status !== 0) throw new Error(`codegen failed: ${r.stderr}`);

// Replace the import-from-package paths in the generated file with absolute
// paths to the in-repo runtime (we don't actually publish "capnwasm/rest"
// during this test).
let generated = readFileSync(outPath, "utf8");
const runtimeUrl = pathToFileURL(resolve(ROOT, "js", "rest_runtime.mjs")).href;
generated = generated.replaceAll('"capnwasm/rest"', JSON.stringify(runtimeUrl));
writeFileSync(outPath, generated);

const { createTestAPIClient } = await import(pathToFileURL(outPath).href);
const { auth, RestError } = await import(runtimeUrl);

// ---- Mock server ------------------------------------------------------
let flakyAttempts = 0;
let serverPort = 0;
let server;

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${serverPort}`);
    const auth = req.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing bearer" }));
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk.toString("utf8");

    // GET /items/{id}
    let m;
    if (req.method === "GET" && (m = url.pathname.match(/^\/items\/(\d+)$/))) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: +m[1], name: "Item " + m[1], tags: ["a", "b"] }));
      return;
    }
    // GET /items?limit=...&status=...&after=...
    if (req.method === "GET" && url.pathname === "/items") {
      const after = url.searchParams.get("after");
      if (after === "page2") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: 3, name: "Item 3", tags: [] }], next_cursor: "" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        data: [{ id: 1, name: "Item 1", tags: [] }, { id: 2, name: "Item 2", tags: [] }],
        next_cursor: "page2",
      }));
      return;
    }
    // POST /items
    if (req.method === "POST" && url.pathname === "/items") {
      const parsed = JSON.parse(body);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 99, name: parsed.name, tags: [] }));
      return;
    }
    // PUT /items/{id}
    if (req.method === "PUT" && (m = url.pathname.match(/^\/items\/(\d+)$/))) {
      const parsed = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: +m[1], name: parsed.name, tags: [] }));
      return;
    }
    // DELETE /items/{id}
    if (req.method === "DELETE" && (m = url.pathname.match(/^\/items\/(\d+)$/))) {
      res.writeHead(204);
      res.end();
      return;
    }
    // GET /items/{id}/raw
    if (req.method === "GET" && (m = url.pathname.match(/^\/items\/(\d+)\/raw$/))) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([1, 2, 3, 4, 5]));
      return;
    }
    // POST /upload (multipart)
    if (req.method === "POST" && url.pathname === "/upload") {
      const ct = req.headers["content-type"] ?? "";
      if (!ct.startsWith("multipart/form-data")) {
        res.writeHead(400); res.end(JSON.stringify({ error: "expected multipart" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "uploaded", size: body.length }));
      return;
    }
    // GET /search?q=...
    if (req.method === "GET" && url.pathname === "/search") {
      const q = url.searchParams.get("q");
      const traceId = req.headers["x-trace-id"] ?? null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ id: 0, name: `match:${q}`, tags: [traceId ?? "no-trace"] }]));
      return;
    }
    // GET /flaky. Returns 503 first 2 attempts, 200 on the 3rd. Tests retry.
    if (req.method === "GET" && url.pathname === "/flaky") {
      flakyAttempts++;
      if (flakyAttempts < 3) {
        res.writeHead(503); res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // GET /slow. Sleeps 200ms. Tests timeout/cancellation.
    if (req.method === "GET" && url.pathname === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 200);
      return;
    }
    // GET /error. Returns a structured error body for RestError tests.
    if (req.method === "GET" && url.pathname === "/error") {
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "validation_failed", details: ["bad name"] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  serverPort = server.address().port;
});

after(() => server?.close());

function client(opts = {}) {
  return createTestAPIClient({
    baseUrl: `http://127.0.0.1:${serverPort}`,
    auth: auth.bearer("secret-token"),
    retries: { count: 2, backoff: "linear", baseDelay: 10 },
    ...opts,
  });
}

// ---- Tests ------------------------------------------------------------
test("REST: GET path param", async () => {
  const item = await client().getItem(7);
  assert.equal(item.id, 7);
  assert.equal(item.name, "Item 7");
});

test("REST: GET query params (omits undefined)", async () => {
  const list = await client().listItems(10, undefined);
  assert.equal(list.data.length, 2);
});

test("REST: paginated AsyncIterable yields across pages until next_cursor empties", async () => {
  const ids = [];
  for await (const item of client().streamItems()) ids.push(item.id);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("REST: POST JSON body", async () => {
  const c = await client().createItem({ name: "Zoom" });
  assert.equal(c.id, 99);
  assert.equal(c.name, "Zoom");
});

test("REST: PUT path + body", async () => {
  const u = await client().updateItem(5, { name: "Updated" });
  assert.equal(u.id, 5);
  assert.equal(u.name, "Updated");
});

test("REST: DELETE returns nothing on 204", async () => {
  const v = await client().deleteItem(42);
  assert.equal(v, "");  // empty body decoded as text
});

test("REST: arrayBuffer decode for binary endpoint", async () => {
  const buf = await client().getItemRaw(1);
  assert.ok(buf instanceof ArrayBuffer);
  assert.equal(buf.byteLength, 5);
});

test("REST: multipart upload sets correct Content-Type", async () => {
  const fd = new FormData();
  fd.append("file", new Blob(["hello"]), "f.txt");
  fd.append("name", "thing");
  const r = await client().upload(fd);
  assert.equal(r.id, "uploaded");
});

test("REST: header param uses wire name (X-Trace-Id), not JS name (traceId)", async () => {
  const r = await client().search("kitten", "trace-abc");
  assert.equal(r[0].tags[0], "trace-abc");
});

test("REST: retries on 503; succeeds on the 3rd attempt", async () => {
  flakyAttempts = 0;
  const r = await client().flaky();
  assert.equal(r.ok, true);
  assert.ok(flakyAttempts >= 3, `expected ≥3 attempts, got ${flakyAttempts}`);
});

test("REST: cancellation via AbortSignal aborts in flight", async () => {
  const ctrl = new AbortController();
  const p = client().slow({ signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 30);
  await assert.rejects(p, (err) => err.name === "AbortError" || /aborted/.test(err.message));
});

test("REST: timeout option aborts after deadline", async () => {
  const c = client({ retries: { count: 0 } });
  await assert.rejects(c.slow({ timeout: 30 }), /timeout|aborted/);
});

test("REST: non-2xx throws RestError with status + parsed body", async () => {
  const c = client({ retries: { count: 0 } });
  try {
    await c.error();
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof RestError);
    assert.equal(err.status, 422);
    assert.equal(err.body.error, "validation_failed");
    assert.deepEqual(err.body.details, ["bad name"]);
  }
});

test("REST: missing bearer auth gets 401", async () => {
  const c = createTestAPIClient({
    baseUrl: `http://127.0.0.1:${serverPort}`,
    // no auth
    retries: { count: 0 },
  });
  await assert.rejects(c.getItem(1), (err) => err.status === 401);
});
