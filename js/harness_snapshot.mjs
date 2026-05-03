// Failure-replay snapshots for the contract harness.
//
// When a generated test fails, the test wraps the assertion in a
// recorder (see `recordOnFailure` below) that writes a snapshot to the
// configured directory. The snapshot captures everything needed to
// re-run the exact same call: operation ID, method args, the response
// (when one came back), and the raised error. Re-running with
// `npx capnwasm harness --replay <snapshot>` reproduces the call
// without re-invoking the test runner.
//
// Snapshot file shape (.snapshot.json):
//
//   {
//     "snapshotVersion": 1,
//     "createdAt": "2026-...",
//     "operationId": "<api>.<method>",
//     "transport": "rest" | "capnp",
//     "request": {
//       "method": "GET",
//       "url": "https://...",
//       "headers": { ... },
//       "body": <object|string|null>
//     },
//     "response": {
//       "status": 500,
//       "headers": { ... },
//       "body": <object|string|null>
//     },
//     "error": "AssertionError: ..."
//   }

const SNAPSHOT_VERSION = 1;
const DEFAULT_DIR = "./capnwasm-snapshots";

/**
 * Default snapshot directory. Resolved from
 * CAPNWASM_HARNESS_SNAPSHOT_DIR or `./capnwasm-snapshots`.
 */
export function snapshotDir() {
  return process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR || DEFAULT_DIR;
}

/**
 * Wrap an async test function so that on failure a snapshot is written
 * capturing the operation / args / error. Used by the emitted harness.
 *
 * @param {object} ctx - { operationId, transport, args }
 * @param {() => Promise<any>} fn - the test body
 */
export async function recordOnFailure(ctx, fn) {
  const captured = { request: null, response: null };
  // Allow the test body to attach request / response details so the
  // snapshot can include them. The default fetch wrapper below
  // populates these via global hooks.
  globalThis.__capnwasm_capture = captured;
  try {
    return await fn();
  } catch (err) {
    await writeFailureSnapshot({
      operationId: ctx.operationId,
      transport: ctx.transport ?? "rest",
      args: ctx.args ?? [],
      request: captured.request,
      response: captured.response,
      error: String(err?.stack ?? err),
    });
    throw err;
  } finally {
    delete globalThis.__capnwasm_capture;
  }
}

/**
 * fetch wrapper that records request + response into the test's
 * snapshot capture slot. Generated harnesses install this as the
 * client's `fetch` option so we don't need clients to know anything
 * about snapshots.
 */
export function recordingFetch(realFetch = globalThis.fetch) {
  return async (url, init = {}) => {
    const reqRecord = {
      method: (init.method ?? "GET").toUpperCase(),
      url: String(url),
      headers: { ...(init.headers ?? {}) },
      body: bodyForSnapshot(init.body),
    };
    let res;
    try {
      res = await realFetch(url, init);
    } catch (err) {
      if (globalThis.__capnwasm_capture) {
        globalThis.__capnwasm_capture.request = reqRecord;
        globalThis.__capnwasm_capture.response = { error: String(err?.message ?? err) };
      }
      throw err;
    }
    if (globalThis.__capnwasm_capture) {
      globalThis.__capnwasm_capture.request = reqRecord;
      globalThis.__capnwasm_capture.response = await responseToSnapshot(res.clone());
    }
    return res;
  };
}

async function responseToSnapshot(res) {
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const ct = res.headers.get("content-type") ?? "";
  let body = null;
  try {
    if (ct.includes("application/json")) body = await res.json();
    else body = await res.text();
  } catch {
    body = "<unreadable>";
  }
  return { status: res.status, headers, body };
}

function bodyForSnapshot(body) {
  if (body == null) return null;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return body; }
  }
  if (body instanceof Uint8Array) return `<bytes:${body.length}>`;
  return body;
}

async function writeFailureSnapshot(snap) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = snapshotDir();
  await fs.mkdir(dir, { recursive: true });
  const safeOp = snap.operationId.replace(/[^A-Za-z0-9._-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${safeOp}.${stamp}.snapshot.json`);
  const payload = {
    snapshotVersion: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    ...snap,
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n");
  // Surface the path on stderr so the test runner's output points to it.
  process.stderr.write(`  snapshot: ${file}\n`);
  return file;
}

/**
 * Re-run the request captured by a snapshot. Used by the
 * `npx capnwasm harness --replay <snapshot>` command. Returns the new
 * response (with status + body) and a one-line diff against the
 * snapshot's recorded response.
 */
export async function replay(snapshotPath, opts = {}) {
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(snapshotPath, "utf8");
  const snap = JSON.parse(text);
  if (!snap.request) throw new Error("replay: snapshot has no request block");
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const init = {
    method: snap.request.method,
    headers: snap.request.headers,
  };
  if (snap.request.body !== null && snap.request.body !== undefined) {
    init.body = typeof snap.request.body === "string"
      ? snap.request.body
      : JSON.stringify(snap.request.body);
    if (init.headers && !Object.keys(init.headers).some((k) => k.toLowerCase() === "content-type")) {
      init.headers["content-type"] = "application/json";
    }
  }
  const res = await fetchFn(snap.request.url, init);
  const newResponse = await responseToSnapshot(res);
  const diff = diffResponses(snap.response, newResponse);
  return { snapshot: snap, response: newResponse, diff };
}

function diffResponses(prev, next) {
  if (!prev) return { changed: true, kind: "no-prior-response" };
  if (!next) return { changed: true, kind: "no-current-response" };
  if (prev.status !== next.status) return { changed: true, kind: "status", prev: prev.status, next: next.status };
  // Body: stringify both, compare. Cheap but readable.
  const prevBody = JSON.stringify(prev.body);
  const nextBody = JSON.stringify(next.body);
  if (prevBody !== nextBody) return { changed: true, kind: "body" };
  return { changed: false };
}
