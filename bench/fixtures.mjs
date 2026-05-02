// Representative payloads exercised by both implementations.
// Each fixture is a "logical" RPC call: the implementation under test must be
// able to encode it from a JS value and decode it back to a JS value.

let _b64 = null;
function base64Of64K() {
  if (_b64) return _b64;
  const bytes = new Uint8Array(64 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  _b64 = btoa(bin);
  return _b64;
}

function buildLargeObject(n) {
  const obj = {};
  for (let i = 0; i < n; i++) {
    obj[`field${i}`] = `value-${i}-${"x".repeat(32)}`;
  }
  return obj;
}

function buildArrayOfObjects(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: i, name: `item-${i}`, active: (i & 1) === 0 });
  }
  return [arr];
}

function buildDeepPipeline(depth) {
  let expr = ["import", 0];
  for (let i = 0; i < depth; i++) {
    expr = ["pipeline", expr, [`step${i}`]];
  }
  return expr;
}

export const fixtures = [
  {
    name: "small-call",
    desc: "Small method call: push pipeline(import 0).greet('Alice')",
    value: ["push", ["pipeline", ["import", 0], ["greet"], [["Alice"]]]],
  },
  {
    name: "medium-payload",
    desc: "Object with 32 string fields (~2KB)",
    value: ["push", buildLargeObject(32)],
  },
  {
    name: "wide-payload",
    desc: "Object with 512 string fields (~25KB). For sparse-access lazy bench",
    value: ["push", buildLargeObject(512)],
  },
  {
    name: "large-array",
    desc: "Array of 256 small objects (~16KB)",
    value: ["push", buildArrayOfObjects(256)],
  },
  {
    name: "binary-blob",
    desc: "Push containing a 64KB binary payload",
    value: ["push", ["bytes", base64Of64K()]],
  },
  {
    name: "deep-pipeline",
    desc: "Pipeline chain depth = 8",
    value: ["push", buildDeepPipeline(8)],
  },
  {
    name: "pull",
    desc: "Pull message",
    value: ["pull", 7],
  },
  {
    name: "release",
    desc: "Release message",
    value: ["release", 7, 1],
  },
];
