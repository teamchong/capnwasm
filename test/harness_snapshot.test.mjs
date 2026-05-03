// Failure-replay snapshots for the contract harness.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordOnFailure, recordingFetch, replay, snapshotDir } from "../js/harness_snapshot.mjs";

function withSnapDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-snap-"));
  const prev = process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR;
  process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR = dir;
  return Promise.resolve(fn(dir)).finally(() => {
    if (prev === undefined) delete process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR;
    else process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR = prev;
  });
}

test("snapshotDir: respects CAPNWASM_HARNESS_SNAPSHOT_DIR, falls back to default", () => {
  const prev = process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR;
  delete process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR;
  assert.equal(snapshotDir(), "./capnwasm-snapshots");
  process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR = "/tmp/x";
  assert.equal(snapshotDir(), "/tmp/x");
  if (prev === undefined) delete process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR;
  else process.env.CAPNWASM_HARNESS_SNAPSHOT_DIR = prev;
});

test("recordOnFailure: writes a snapshot on assertion failure", async () => {
  await withSnapDir(async (dir) => {
    let threw = false;
    try {
      await recordOnFailure({ operationId: "DemoApi.listItems", transport: "rest", args: [10, "abc"] }, async () => {
        // Capture a request via the recording fetch wrapper.
        const fetch = recordingFetch(async () => ({
          status: 500,
          headers: new Map([["content-type", "application/json"]]),
          clone() { return this; },
          json: async () => ({ error: "boom" }),
          text: async () => '{"error":"boom"}',
        }));
        const r = await fetch("https://example.test/items", { method: "GET", headers: { accept: "json" } });
        // Simulate a failed assertion in the test body.
        throw new Error("AssertionError: expected status 200, got " + r.status);
      });
    } catch (err) {
      threw = true;
      assert.match(err.message, /AssertionError/);
    }
    assert.ok(threw, "expected the test body to rethrow");
    const files = readdirSync(dir).filter((f) => f.endsWith(".snapshot.json"));
    assert.equal(files.length, 1);
    const snap = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
    assert.equal(snap.snapshotVersion, 1);
    assert.equal(snap.operationId, "DemoApi.listItems");
    assert.equal(snap.transport, "rest");
    assert.deepEqual(snap.args, [10, "abc"]);
    assert.equal(snap.request.method, "GET");
    assert.equal(snap.request.url, "https://example.test/items");
    assert.equal(snap.response.status, 500);
    assert.deepEqual(snap.response.body, { error: "boom" });
    assert.match(snap.error, /AssertionError/);
  });
});

test("recordOnFailure: writes nothing when the test body succeeds", async () => {
  await withSnapDir(async (dir) => {
    await recordOnFailure({ operationId: "DemoApi.healthy", transport: "rest", args: [] }, async () => "ok");
    assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
  });
});

test("replay: re-runs the captured request and reports diff status when response is unchanged", async () => {
  await withSnapDir(async (dir) => {
    // Hand-author a snapshot so the test doesn't depend on harness emit.
    const snapPath = join(dir, "demo.snapshot.json");
    writeFileSync(snapPath, JSON.stringify({
      snapshotVersion: 1,
      createdAt: new Date().toISOString(),
      operationId: "Demo.x",
      transport: "rest",
      args: [],
      request: { method: "GET", url: "https://example.test/x", headers: {}, body: null },
      response: { status: 200, headers: { "content-type": "application/json" }, body: { ok: true } },
    }, null, 2));

    let calls = 0;
    const fakeFetch = async (url, init) => {
      calls++;
      return {
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        clone() { return this; },
        json: async () => ({ ok: true }),
        text: async () => '{"ok":true}',
      };
    };
    const result = await replay(snapPath, { fetch: fakeFetch });
    assert.equal(calls, 1);
    assert.equal(result.response.status, 200);
    assert.equal(result.diff.changed, false);
  });
});

test("replay: surfaces a diff when the response status changes", async () => {
  await withSnapDir(async (dir) => {
    const snapPath = join(dir, "demo.snapshot.json");
    writeFileSync(snapPath, JSON.stringify({
      snapshotVersion: 1,
      createdAt: new Date().toISOString(),
      operationId: "Demo.x",
      transport: "rest",
      args: [],
      request: { method: "GET", url: "https://example.test/x", headers: {}, body: null },
      response: { status: 500, headers: {}, body: { error: "boom" } },
    }, null, 2));

    const fakeFetch = async () => ({
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      clone() { return this; },
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    });
    const result = await replay(snapPath, { fetch: fakeFetch });
    assert.equal(result.diff.changed, true);
    assert.equal(result.diff.kind, "status");
    assert.equal(result.diff.prev, 500);
    assert.equal(result.diff.next, 200);
  });
});
