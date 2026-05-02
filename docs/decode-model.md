# How decode/encode actually works

A user-facing explanation of what happens between `await cap.method()` and
`reader.fieldFoo`. Useful when you're trying to reason about cost or
benchmark against capnweb / gRPC-Web / raw JSON.

## The short version

You don't ask for fields. You read them. The codegen emits a getter per
field; only the fields you touch get decoded. There is no `pick` API
because there's no `parse-everything-then-pick` step to skip.

```js
const reader = ctx.openParams(MyMessageReader);
const x = reader.userId;        // decoded
const y = reader.timestamp;     // decoded
//   reader.bigOptionalBlob     // never touched, never decoded, no cost
```

For primitives this lands as a direct
[`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView)
read against wasm linear memory. No boundary call, no copy. V8/TurboFan
inlines those DataView calls down to a single load instruction in JIT.
For text / lists / nested structs we do cross the wasm boundary, which
adds ~50-100 ns of overhead per call.

## The two-path getter

What the codegen actually emits per primitive field, lightly cleaned up
from `bin/capnwasm.mjs`:

```js
get fieldFoo() {
  return this._dataPtr
    ? this._dv.getUint32(this._dataPtr + 12, true)   // FAST: in-place read
    : this._exp.cpp_any_uint32_at(12, 0);             // SLOW: wasm call
}
```

`_dataPtr` is set when the Reader was opened via the zero-copy entry
points. `ctx.openParams(Builder)` server-side, or `cap.callBuilder()`
on the client side returning `extract(reader, ...)` callbacks. When set,
every primitive getter is a `DataView.getX(ptr+off, true)`. No boundary
crossing. This is what makes `bench/realistic.mjs`'s sparse-field test
tie with capnweb (read 3 of 32 fields ≈ 27 µs/call for both, even though
capnweb has parsed all 32 by the time you ask).

The slow path exists for the legacy `paramsBytes`/`bytes` route where
the bytes have been snapshotted out of wasm memory. There's no live
`dataPtr` to read from, so we ask the C++ side to walk the message and
return the value. Still avoids a copy of unrelated fields, but pays a
wasm call per field.

## Cost table (single field read)

| Field type | Path | Cost | What runs |
|---|---|---|---|
| Bool | direct | ~0.5 ns | `u8[ptr+off] >> bit & 1` |
| Int8 / UInt8 | direct | ~1 ns | indexed `Uint8Array` load |
| Int16-32, UInt16-32 | direct | ~1 ns | `dv.getInt32(ptr+off, true)` - V8 inlines |
| Int64 / UInt64 | direct | ~2 ns | `dv.getBigInt64` (or split lo/hi for safe-int) |
| Float32 / Float64 | direct | ~1 ns | typed-array reinterpret view |
| Text | wasm | ~50-100 ns | `cpp_any_text_at(idx)` → walks pointer, returns len |
| Data (binary) | wasm | ~50-100 ns | same; bytes are a `subarray` of wasm memory (no copy) |
| List of primitives | wasm + direct | one boundary call to position the cursor, then DataView reads per element |
| Nested struct | wasm | one boundary call to enter, then direct reads on the nested Reader |
| Capability | wasm | one boundary call to read the cap descriptor |

Numbers are order-of-magnitude on Apple Silicon Node 22; absolute values
move with hardware and JIT warmup.

## Why TurboFan handles it

Three things let V8 optimize Readers aggressively:

1. **Stable hidden class.** Every Reader's constructor sets the same
   properties (`_cpp`, `_exp`, `_dataPtr`, `_u8`, `_dv`) in the same
   order. V8 builds one shape; subsequent `reader.fieldX` accesses are
   monomorphic.
2. **DataView is JIT-friendly.** V8 (and SpiderMonkey, JavaScriptCore)
   inline `DataView.getUint32(constant_offset, true)` into a single
   memory load. Comparable to `arr[i]` once warm.
3. **The ternary branch settles.** `this._dataPtr ? fast : slow` is one
   conditional. After a few calls, V8's branch predictor figures out
   which side a given Reader instance takes and elides the cost.

The codegen explicitly preserves this. `bin/capnwasm.mjs` has a comment
on `_dv` allocation: "Allocating a DataView is cheap; V8 inlines."

## The ergonomics question

You may have seen this pattern in capnweb:

```js
const data = await api.getThing();
console.log(data.user.id);
```

`data` is a JS object after `JSON.parse`. Property access is native.
Nothing exotic. Same as `fetch().json()`.

In capnwasm:

```js
const result = await cap.callBuilder(IFC, METHOD, MyParams).send().promise;
// result.bytes is the framed response
const reader = new MyResultReader(cpp, dataPtrFromResult);
console.log(reader.user.id);
```

…but with the typed proxy, it becomes:

```js
const result = await api.getThing();
console.log(result.user.id);
```

Same shape as capnweb at the call site. The reader behind `result` is
the codegen-emitted class. `.user` returns a nested Reader; `.id` is a
DataView read.

The cost difference: capnweb has already parsed `result` end-to-end at
this point. We've parsed nothing. Accessing `.user.id` decodes exactly
those two fields. If you then access `.user.name`, that's another
DataView read; never a re-parse.

## When the wasm boundary matters

Per-field overhead becomes visible when you read a LOT of fields in a
hot loop. Example:

```js
for (let i = 0; i < records.length; i++) {
  const r = records.at(i);
  acc += r.amount * r.fxRate;
}
```

If `amount` and `fxRate` are Int64, you pay ~2 ns × 2 × N. For 1000
records that's ~4 µs. Invisible. For 1M records it's ~4 ms.

If `amount` is text (e.g., "$12.34"): ~50 ns × 1 × N. For 1M records,
~50 ms. Avoid text-typed numerics in inner loops.

For the sub-µs regime, capnweb's "everything is already a JS number" wins
- V8's number-handling for JS doubles is even cheaper than DataView
reads. capnwasm's edge shows up in:

- Sparse access (read 3 of 32). Capnweb pays full parse cost regardless;
  we pay only the 3 fields.
- Big payloads. JSON's tag-length-value encoding makes parse O(N bytes),
  while we read O(touched fields).
- Binary data. Capnweb base64-encodes, paying ~33% wire overhead and
  decode CPU. We pass binary through as a `Uint8Array` view of wasm
  memory.

## What you can't do (and why)

- **You can't hold a Reader across an `await`.** The wasm scratch buffer
  may be reused for the next inbound message. If you need to keep
  values, copy them out into JS-owned variables before yielding:
  ```js
  // Wrong. Reader bytes may be invalid after await
  const reader = ctx.openParams(MyParamsReader);
  await someAsyncWork();
  console.log(reader.userId);   // possibly garbage

  // Right. Copy what you need first
  const reader = ctx.openParams(MyParamsReader);
  const userId = reader.userId;
  await someAsyncWork();
  console.log(userId);          // safe
  ```
- **You can't construct a Reader from arbitrary bytes.** The Reader
  expects `dataPtr` to be a position inside the wasm linear memory,
  managed by the session. The legacy `paramsBytes`/`r.bytes` path is
  what gives you a JS-owned snapshot. Those go through the slow path.

## Encode side (Builder)

Symmetric. `ctx.beginResults(MyResultBuilder)` returns a Builder with
its `_dataPtr` set into the wasm builder's arena:

```js
const b = ctx.beginResults(MyResultBuilder);
b.userId = 42;          // dv.setBigUint64(this._dataPtr + 0, 42n, true)
b.timestamp = Date.now();
// session.#sendStreamChunk reads the finalized bytes from wasm memory
// without an intermediate JS copy.
```

`b.field = value` setters are direct DataView writes to wasm memory.
For text/data/lists/nested structs, the setter calls into wasm to
allocate the right pointer and walks the layout, then either gives you
a sub-Builder (you write into it) or copies your bytes in.

`bench/realistic.mjs` shows the build-time cost: at 4 KB text echo we
spend ~17 µs round-trip. Most of which is wire send + receive, not
encode/decode work.

## Reproducing

```bash
node bench/rpc_bench.mjs       # tiny + small + medium + large + cap-passing
node bench/realistic.mjs       # burst, wire bytes, sparse access
```

Or look at a real Reader:

```bash
cat js/typed_schema.gen.mjs    # text fields only. See the wasm-call shape
# For mixed primitive + text, run `npx capnwasm gen` against a richer schema
# and look at the emitted .gen.mjs.
```
