# Runtime-schema reader / builder

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time, but the current 0.0.x runtime still uses fixed scratch buffers, rejects messages larger than scratch capacity, ties readers to mutable wasm linear memory, and does not zero scratch memory after use. Treat it as a controlled demo, experiment, and small/medium payload prototype while production hardening continues.

Read and write Cap'n Proto messages without running `npx capnwasm gen`. The schema lives as plain JS data, the wasm runtime stays the same. This is the same bytes a codegen reader for the same schema would see.

## When to use

| | dynamic | codegen |
|---|---|---|
| Schema known at build time | works | **preferred** - typed, faster builders, list/nested write support |
| Schema arrives at runtime (tenant uploads, admin tools, GraphQL fragments) | **only option** | not applicable |
| Subset of fields varies per request | **fast** - `pick(names)` is one wasm call | works, same speed |
| Bundle-size sensitive (no per-schema codegen output) | **smaller** - one runtime, every schema | adds 2-3 KB per generated `.gen.mjs` |
| Production hot path | works - reads ~1.17× slower, batched picks slightly faster, writes ~1.6× slower | **faster** on per-field reads and writes |

If the schema doesn't change between deploys, codegen is the right answer. The dynamic API exists for the cases codegen can't reach.

## Defining a schema

```js
import { defineSchema } from "capnwasm/dynamic";

const User = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  active: { kind: "bool",   bitOffset: 64 },
  name:   { kind: "text",   slot: 0 },
});
```

Each field has a kind plus the wire-format location. Primitives use `offset` (in bytes within the data section), pointer-typed fields (`text`, `data`, lists, structs) use `slot` (the pointer-section index), and bools use `bitOffset` (in bits within the data section).

## Reading

```js
import { load } from "capnwasm";
import { openDynamic } from "capnwasm/dynamic";

const cpp = await load();
const r = openDynamic(cpp, User, bytes);

r.get("name");                 // "Ada"
r.fields.name;                 // same, Proxy-style
r.pick(["name", "id"]);        // batched. One wasm call regardless of count
r.toObject();                  // every field in the schema
```

Three access modes:

- **`get(name)`**: single field, one wasm call. Use when you only want one or two values.
- **`pick(names)`**: batch read of an arbitrary subset, one wasm boundary call regardless of how many fields. Best for "I want fields A, B, and C" patterns.
- **`fields.name`**: Proxy. Each access calls `get` under the hood. Convenient but each access is a separate wasm call. Use `pick` if reading 3+ fields.

## Writing

For the build side, the schema needs the struct's wire-format dimensions:

```js
const User = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  active: { kind: "bool",   bitOffset: 64 },
  name:   { kind: "text",   slot: 0 },
}, { dataWords: 2, ptrWords: 1 });
```

Three ways to build a message, in order from most explicit to most ergonomic.

```js
import { buildDynamic, encodeDynamic } from "capnwasm/dynamic";

// 1. Setter-by-setter. Most control, useful when fields come from
//    different sources or need conditional logic.
const b = buildDynamic(cpp, User);
b.set("id", 42n);
b.set("active", true);
b.set("name", "Alice");
const bytes = b.finalize();

// 2. fromObject(obj). Apply a plain JS object in one call. Same wire
//    bytes as the setter loop above; the helper just walks the schema
//    fields and calls set() for each defined property.
const bytes2 = buildDynamic(cpp, User)
  .fromObject({ id: 42n, active: true, name: "Alice" })
  .finalize();

// 3. encodeDynamic. One call. Same shape as JSON.stringify on the
//    wire-encoding side. Equivalent to buildDynamic + fromObject + finalize.
const bytes3 = encodeDynamic(cpp, User, { id: 42n, active: true, name: "Alice" });
```

All three produce identical wire bytes. The `encodeDynamic(cpp, schema, obj)` form is the JSON-stringify-shaped one-liner. The form you reach for when the data already lives in a JS object (a D1 row, a parsed third-party API response, an in-memory state object) and you want bytes back.

`dataWords` is the number of 8-byte words in the data section (covers all primitive + bool fields). `ptrWords` is the number of pointer slots (covers all text/data/list/struct fields). For schemas you've codegen'd, the values are `SomethingBuilder._DATA_WORDS` and `_PTR_WORDS`; for fresh schemas you compute them from the field offsets.

`finalize()` is one-shot. Calling it twice throws. `fromObject` is chainable. It returns the builder so you can pipe it into `.finalize()`.

### Type coercion in `fromObject` / `encodeDynamic`

The same coercions `set(name, value)` does, applied per field:

| capnp field | accepts | rule |
|---|---|---|
| `uint64` / `int64` | `bigint`, `number` | Number coerced if safe-integer; precision-lossy values not detected |
| `uint32` / `int32` and below | `number` | masked / shifted as appropriate |
| `float32` / `float64` | `number` | direct |
| `bool` | any truthy/falsy | `if (value)` semantics |
| `text` | `string` or `Uint8Array` | string goes through `TextEncoder.encodeInto` |
| `data` | `Uint8Array` | direct copy into wasm memory |
| missing key | unset | leave default (zero / empty) |
| unknown key | ignored | schema is the contract |

Set `value: undefined` or simply omit the key to leave a field at its default.

## Field kind reference

### Primitives

| kind | location | JS type |
|---|---|---|
| `uint8` `uint16` `uint32` | `offset` (bytes) | number |
| `int8` `int16` `int32` | `offset` (bytes) | number |
| `uint64` `int64` | `offset` (bytes) | number if safe-integer, BigInt otherwise |
| `float32` `float64` | `offset` (bytes) | number |
| `bool` | `bitOffset` (bits) | boolean |
| `text` | `slot` | string |
| `data` | `slot` | Uint8Array |

### Lists of primitives

| kind | location | JS type |
|---|---|---|
| `listUint8` `listUint16` `listUint32` `listUint64` | `slot` | array of numbers / BigInts |
| `listInt8` `listInt16` `listInt32` `listInt64` | `slot` | array |
| `listFloat32` `listFloat64` | `slot` | array of numbers |
| `listBool` | `slot` | array of booleans |
| `listText` | `slot` | array of strings |
| `listData` | `slot` | array of Uint8Arrays |

### Composite (read-only)

| kind | location | shape |
|---|---|---|
| `struct` | `slot` + `schema` | nested object - runs `schema` recursively, returns plain object |
| `listStruct` | `slot` + `element` | array of objects - each element materialized via `element` schema |

```js
const Comment = defineSchema({
  body:   { kind: "text",   slot: 0 },
  author: { kind: "text",   slot: 1 },
});

const Post = defineSchema({
  title:    { kind: "text",       slot: 0 },
  comments: { kind: "listStruct", slot: 1, element: Comment },
  author:   { kind: "struct",     slot: 2, schema: defineSchema({
    name: { kind: "text", slot: 0 },
  }) },
});

const r = openDynamic(cpp, Post, bytes);
r.get("comments");   // [{ body: "...", author: "..." }, ...]
r.get("author");     // { name: "..." }
```

For null-pointer slots, nested structs come back with each field at its type's default (zero / `""` / `[]`), matching the codegen reader's wire-format semantics. List slots default to `[]`.

## Performance

Bench on Node 22, `Primitives` struct from `cpp/conformance_schema.capnp` (13 fields covering every primitive type). Each test runs in its own subprocess to isolate V8 state; numbers are medians across 5 runs after a 1000-iteration warmup. Reproduce with `pnpm bench:dynamic`.

```
read all 13 fields           codegen ~476 ns,  dynamic ~531 ns/call    (codegen 1.12× faster)
batched pick(3 fields)       codegen ~489 ns,  dynamic ~443 ns/call    (dynamic 1.10× faster)
build with 13 fields         codegen ~744 ns,  dynamic ~1299 ns/call   (codegen 1.75× faster)
```

**Per-field reads**: codegen wins because field offsets are baked as integer literals at the call site; the dynamic path looks up the field by name in a Map and dispatches via switch-on-type.

**Batched `pick(...)`**: dynamic edges out slightly. Both paths do the same single wasm boundary call; dynamic's `DynamicReader` constructor allocates one fewer hidden class.

**Writes**: codegen wins by a wider margin. Codegen builders write primitives directly to memory at literal byte offsets; the dynamic builder dispatches by field type for every `set()`.

**Two corrections to earlier numbers in this project.** An earlier pass of this bench showed dynamic ~30% *faster* on per-field reads. That was a codegen bug. Float getters had a per-instance lazy `new ArrayBuffer` allocation. Each new reader paid the alloc on first f32/f64 access. Fixed by hoisting to module scope. Then a write-side bug surfaced: the codegen builder allocated `new DataView(this._u8.buffer)` per i64/f32/f64 setter call. Cached in the constructor; codegen builds got 11% faster. Both fixes apply across every generated reader/builder, not just the bench schema.

For tenant-uploaded schemas and admin tools. The cases the dynamic path exists to serve. Sub-microsecond per field read and ~1.3 µs to build a 13-field struct is fast enough. Don't pick dynamic for hot loops if the schema is stable; pick it for the cases codegen can't reach.

## Compatibility with codegen output

`defineSchema`'s internal representation matches the `_FIELDS` static that codegen emits on each generated reader class. A build pipeline that wants both worlds can:

```js
import { UserReader } from "./user.gen.mjs";
import { DynamicReader } from "capnwasm/dynamic";

// Hand-construct a schema object from the codegen output.
const dynamicUser = { fields: UserReader._FIELDS };

// And feed it directly:
const r = new DynamicReader(cpp, dynamicUser);
```

This is useful for tools that want to walk an arbitrary message generically (inspectors, diff viewers) but already have a codegen'd reader sitting around for the schema.

## What landed in this pass

- **List of primitives builders**. Every numeric type, bool, text, data. Init + per-element write, both via the wasm cursor.
- **Nested-struct builders**. `kind: "struct"` with a recursive `schema:`. In-place write via a wasm cursor stack (max depth 8); wire bytes are bit-identical to a single end-to-end build. Arbitrarily-deep nesting.
- **List-of-struct builders**. `kind: "listStruct"` with an `element:` schema. Initializes a `List<AnyStruct>` of the right element size at the parent's pointer slot, then writes each element in-place by pushing onto the cursor stack.

## What's not in this pass

- **Capability fields**. Caps are server-managed identities, not data; capnwasm/dynamic is for plain data structs. RPC clients can still send caps via the codegen RPC layer.
- **Unions**. Discriminant reading works (via the underlying `cpp_any_uint16_at`), but there's no friendly union API. Model unions as a `which` field plus per-variant fields and check `which` directly.

For these, codegen is the answer.
