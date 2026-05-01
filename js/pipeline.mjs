// Pipeline: send N dependent calls in one round-trip.
//
// The N+1 problem in async/await: writing
//
//   const u = await api.user.get(id);
//   const o = await api.orders.get(u.id);
//
// costs 2 round-trips even though the server could do both back-to-back.
// Cap'n Proto's promise pipelining already covers the case where call B
// uses a *capability* returned by call A — but for scalar field deps
// across an `await`, JS gives no async-context hook to auto-batch.
//
// Pipeline is the explicit composition: build a batch on the client,
// declare which bytes of call N's result splice into call N+1's params,
// send the whole thing in one frame. Server executes sequentially
// without bouncing back to the client between calls.
//
// Server side (opt-in registration on a normal InterfaceRegistry):
//
//   import { registerPipelineHandler } from "capnwasm/pipeline";
//   registerPipelineHandler(registry);
//
// Client side:
//
//   import { pipeline } from "capnwasm/pipeline";
//   const p = pipeline(serverCap);
//   const u = p.call(USER_IFC, GET, userParams);
//   const o = p.call(ORDER_IFC, GET, orderTemplate, [
//     { fromCall: u, fromOffset: 16, length: 8, toOffset: 24 },
//   ]);
//   const [userResult, orderResult] = await p.execute();

const SHARED_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();

export const PIPELINE_INTERFACE_ID = 0xcafe5e5d51e7e1f1n;
export const PIPELINE_METHOD_RUN = 0;

// Wire format — hand-coded so the pipeline runner doesn't need a separate
// codegen step. All multi-byte ints are little-endian.
//
// Batch (params of run):
//   u32 callCount
//   for each call:
//     u64 ifcId
//     u32 methodId
//     u32 paramsLen
//     paramsLen bytes
//     u32 spliceCount
//     for each splice:
//       u32 fromCall
//       u32 fromOffset
//       u32 fromLen
//       u32 toOffset
//
// Results (results of run):
//   u32 callCount
//   for each result:
//     u8 status  (0=ok, 1=error)
//     u32 dataLen
//     dataLen bytes  (results bytes if ok, UTF-8 error message if err)

function encodeBatch(calls) {
  // Two-pass: total length first, then write.
  let total = 4;  // callCount
  for (const c of calls) {
    total += 8 + 4 + 4 + c.params.length + 4;
    total += c.splices.length * 16;
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, calls.length, true); p += 4;
  for (const c of calls) {
    dv.setBigUint64(p, c.ifcId, true); p += 8;
    dv.setUint32(p, c.methodId, true); p += 4;
    dv.setUint32(p, c.params.length, true); p += 4;
    out.set(c.params, p); p += c.params.length;
    dv.setUint32(p, c.splices.length, true); p += 4;
    for (const s of c.splices) {
      dv.setUint32(p, s.fromCall, true); p += 4;
      dv.setUint32(p, s.fromOffset, true); p += 4;
      dv.setUint32(p, s.length, true); p += 4;
      dv.setUint32(p, s.toOffset, true); p += 4;
    }
  }
  return out;
}

function decodeBatch(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const callCount = dv.getUint32(p, true); p += 4;
  const calls = [];
  for (let i = 0; i < callCount; i++) {
    const ifcId = dv.getBigUint64(p, true); p += 8;
    const methodId = dv.getUint32(p, true); p += 4;
    const paramsLen = dv.getUint32(p, true); p += 4;
    const params = bytes.slice(p, p + paramsLen); p += paramsLen;
    const spliceCount = dv.getUint32(p, true); p += 4;
    const splices = [];
    for (let j = 0; j < spliceCount; j++) {
      splices.push({
        fromCall: dv.getUint32(p, true),
        fromOffset: dv.getUint32(p + 4, true),
        length: dv.getUint32(p + 8, true),
        toOffset: dv.getUint32(p + 12, true),
      });
      p += 16;
    }
    calls.push({ ifcId, methodId, params, splices });
  }
  return calls;
}

function encodeResults(results) {
  let total = 4;
  for (const r of results) {
    total += 1 + 4 + r.data.length;
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, results.length, true); p += 4;
  for (const r of results) {
    out[p] = r.status; p += 1;
    dv.setUint32(p, r.data.length, true); p += 4;
    out.set(r.data, p); p += r.data.length;
  }
  return out;
}

function decodeResults(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const callCount = dv.getUint32(p, true); p += 4;
  const results = [];
  for (let i = 0; i < callCount; i++) {
    const status = bytes[p]; p += 1;
    const dataLen = dv.getUint32(p, true); p += 4;
    const data = bytes.slice(p, p + dataLen); p += dataLen;
    results.push({ status, data });
  }
  return results;
}

// Wrap the batch payload in a Cap'n Proto frame holding it as a single Data
// (byte list) field. Mirrors the sturdyref module — keeps us off the codegen
// path for one small helper.
function frameBytesPayload(payload) {
  const dataWords = Math.ceil(payload.length / 8);
  const segWords = 1 + dataWords;
  const out = new Uint8Array(8 + segWords * 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, segWords, true);
  dv.setUint32(8, 0x01, true);                            // list pointer, offset 0
  dv.setUint32(12, (payload.length << 3) | 2, true);      // elemSize=2 (byte), count
  out.set(payload, 16);
  return out;
}

function unframeBytesPayload(framed) {
  if (framed.length < 16) throw new Error("pipeline: malformed payload");
  const dv = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  const lo = dv.getUint32(8, true);
  const hi = dv.getUint32(12, true);
  if ((lo & 0x3) !== 1) throw new Error("pipeline: expected list pointer");
  if ((hi & 0x7) !== 2) throw new Error("pipeline: expected byte list");
  const count = hi >>> 3;
  if (16 + count > framed.length) throw new Error("pipeline: payload length exceeds frame");
  return framed.subarray(16, 16 + count);
}

/**
 * Server-side: register the pipeline runner on a registry. The runner
 * dispatches each call in the batch through the SAME registry, so all
 * regularly-registered handlers are reachable through pipelining.
 *
 * @param {object} registry — InterfaceRegistry-shaped
 * @param {object} [opts]
 * @param {(batch: Array<{ifcId: bigint, methodId: number, paramsLen: number, spliceCount: number}>) => void | Promise<void>} [opts.validate]
 *   Called once per inbound batch before any call dispatches. Throw to
 *   reject the whole batch (the pipeline call returns an exception, no
 *   handlers run). Use this to enforce per-batch policy: max calls,
 *   forbidden interface combinations, rate limits by shape, etc. This is
 *   the analog to GraphQL persisted queries / static query plan analysis
 *   for capnwasm. Tools like codesift can wire in here by matching the
 *   batch shape against declarative rules.
 */
export function registerPipelineHandler(registry, opts = {}) {
  if (!registry || typeof registry.register !== "function" || typeof registry.dispatch !== "function") {
    throw new Error("registerPipelineHandler: registry must have register() and dispatch()");
  }
  const validate = opts.validate;
  registry.register(PIPELINE_INTERFACE_ID, PIPELINE_METHOD_RUN, async (target, ctx) => {
    const params = ctx.paramsBytes();
    const batch = decodeBatch(unframeBytesPayload(params));

    if (validate) {
      // Pre-execution shape inspection. Pass a redacted view (sizes, not
      // bytes) so validators can decide policy without copying every
      // call's params. Throwing rejects the whole batch.
      const view = batch.map(c => ({
        ifcId: c.ifcId,
        methodId: c.methodId,
        paramsLen: c.params.length,
        spliceCount: c.splices.length,
      }));
      await validate(view);
    }

    const results = [];

    for (let i = 0; i < batch.length; i++) {
      const call = batch[i];
      // Apply splices: copy bytes from prior results into this call's params.
      let mutableParams = call.params;
      if (call.splices.length > 0) {
        mutableParams = new Uint8Array(call.params);
        for (const s of call.splices) {
          if (s.fromCall >= results.length) {
            results.push({ status: 1, data: SHARED_ENCODER.encode(`pipeline: splice fromCall=${s.fromCall} not yet executed at call ${i}`) });
            return frameBytesPayload(encodeResults(results));
          }
          const src = results[s.fromCall];
          if (src.status !== 0) {
            results.push({ status: 1, data: SHARED_ENCODER.encode(`pipeline: splice depends on failed call ${s.fromCall}`) });
            return frameBytesPayload(encodeResults(results));
          }
          if (s.fromOffset + s.length > src.data.length) {
            results.push({ status: 1, data: SHARED_ENCODER.encode(`pipeline: splice fromOffset=${s.fromOffset}+${s.length} exceeds source result length ${src.data.length} at call ${i}`) });
            return frameBytesPayload(encodeResults(results));
          }
          if (s.toOffset + s.length > mutableParams.length) {
            results.push({ status: 1, data: SHARED_ENCODER.encode(`pipeline: splice toOffset=${s.toOffset}+${s.length} exceeds params length ${mutableParams.length} at call ${i}`) });
            return frameBytesPayload(encodeResults(results));
          }
          mutableParams.set(src.data.subarray(s.fromOffset, s.fromOffset + s.length), s.toOffset);
        }
      }

      const handler = registry.dispatch(target, call.ifcId, call.methodId);
      if (!handler) {
        results.push({ status: 1, data: SHARED_ENCODER.encode(`pipeline: no handler for ${call.ifcId.toString(16)}:${call.methodId}`) });
        continue;
      }

      // Mini-context just for this call. paramsBytes returns the (possibly
      // spliced) params; openParams/beginResults aren't supported inside
      // pipelined calls because we're outside the wasm scratch area.
      let consumed = false;
      const innerCtx = {
        cpp: ctx.cpp,
        paramsBytes() {
          if (consumed) throw new Error("pipeline inner ctx: paramsBytes already read");
          consumed = true;
          return mutableParams;
        },
      };

      try {
        const r = handler(target, innerCtx);
        const awaited = r && typeof r.then === "function" ? await r : r;
        if (awaited instanceof Uint8Array) {
          results.push({ status: 0, data: awaited });
        } else if (awaited && Array.isArray(awaited.caps)) {
          results.push({ status: 1, data: SHARED_ENCODER.encode("pipeline: handlers returning capabilities are not supported inside a pipeline") });
        } else if (awaited == null) {
          results.push({ status: 0, data: new Uint8Array(0) });
        } else {
          results.push({ status: 1, data: SHARED_ENCODER.encode("pipeline: handler returned unsupported result type") });
        }
      } catch (err) {
        results.push({ status: 1, data: SHARED_ENCODER.encode(String(err?.message ?? err)) });
      }
    }

    return frameBytesPayload(encodeResults(results));
  });
}

/**
 * Client-side: build a batch of calls against `serverCap`, then execute()
 * to send them all in one frame.
 */
export function pipeline(serverCap) {
  if (!serverCap || typeof serverCap.call !== "function") {
    throw new Error("pipeline: serverCap must be an RpcCap");
  }
  const calls = [];
  let executed = false;

  function call(ifcId, methodId, params, splices) {
    if (executed) throw new Error("pipeline: cannot add calls after execute()");
    if (!(params instanceof Uint8Array)) {
      throw new Error("pipeline.call: params must be a Uint8Array");
    }
    const idx = calls.length;
    const normalizedSplices = (splices ?? []).map(s => {
      if (typeof s.fromCall !== "number") throw new Error("pipeline splice: fromCall must be a number (call index)");
      return {
        fromCall: s.fromCall,
        fromOffset: s.fromOffset | 0,
        length: s.length | 0,
        toOffset: s.toOffset | 0,
      };
    });
    calls.push({ ifcId, methodId, params, splices: normalizedSplices });
    return idx;
  }

  async function execute() {
    if (executed) throw new Error("pipeline: already executed");
    executed = true;
    const batchBytes = encodeBatch(calls);
    const params = frameBytesPayload(batchBytes);
    const r = await serverCap.call(PIPELINE_INTERFACE_ID, PIPELINE_METHOD_RUN, params, []).promise;
    const inner = unframeBytesPayload(r.bytes);
    const decoded = decodeResults(inner);
    return decoded.map(d => {
      if (d.status === 0) return d.data;
      throw new Error(SHARED_DECODER.decode(d.data));
    });
  }

  return { call, execute, get length() { return calls.length; } };
}
