// Tiny in-memory metrics aggregator. Wire it up with session.onMetric()
// when you don't have OpenTelemetry / Prometheus on hand and just want
// per-method counters + latency histograms.
//
//   import { MetricsAggregator } from "capnwasm/metrics";
//
//   const m = new MetricsAggregator();
//   const unsubscribe = session.onMetric((event, data) => m.record(event, data));
//   // ...do RPC work...
//   console.log(m.snapshot());
//
// For real production, plug session.onMetric directly into your
// OTel/Prometheus client instead. This is a learning aid, not a
// production aggregator. (No percentiles, no histograms, no decay.)

export class MetricsAggregator {
  #perMethod = new Map();   // "0xifc:methodId" → { calls, errors, totalMs, minMs, maxMs }
  #bytesSent = 0;
  #bytesReceived = 0;

  record(event, data) {
    if (event === "callEnd" || event === "dispatchEnd") {
      const key = methodKey(data.interfaceId, data.methodId);
      let entry = this.#perMethod.get(key);
      if (!entry) {
        entry = {
          calls: 0,
          errors: 0,
          totalMs: 0,
          minMs: Infinity,
          maxMs: 0,
          kind: event === "callEnd" ? "outbound" : "inbound",
        };
        this.#perMethod.set(key, entry);
      }
      entry.calls += 1;
      if (data.status === "err") entry.errors += 1;
      const ms = data.durationMs;
      entry.totalMs += ms;
      if (ms < entry.minMs) entry.minMs = ms;
      if (ms > entry.maxMs) entry.maxMs = ms;
    } else if (event === "bytesSent") {
      this.#bytesSent += data.bytes;
    } else if (event === "bytesReceived") {
      this.#bytesReceived += data.bytes;
    }
  }

  snapshot() {
    const methods = {};
    for (const [key, entry] of this.#perMethod) {
      methods[key] = {
        calls: entry.calls,
        errors: entry.errors,
        avgMs: entry.calls > 0 ? entry.totalMs / entry.calls : 0,
        minMs: entry.minMs === Infinity ? 0 : entry.minMs,
        maxMs: entry.maxMs,
        kind: entry.kind,
      };
    }
    return {
      methods,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
    };
  }

  reset() {
    this.#perMethod.clear();
    this.#bytesSent = 0;
    this.#bytesReceived = 0;
  }
}

function methodKey(interfaceId, methodId) {
  const ifcHex = typeof interfaceId === "bigint"
    ? "0x" + interfaceId.toString(16)
    : String(interfaceId);
  return `${ifcHex}:${methodId}`;
}
