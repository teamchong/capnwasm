# Runtime-schema reader / builder

Read and write Cap'n Proto messages without running `npx capnwasm gen`. The schema lives as plain JS data, the wasm runtime stays the same — this is the same bytes a codegen reader for the same schema would see.

## When to use

| | dynamic | codegen |
|---|---|---|
| Schema known at build time | works | **preferred** — typed, faster builders, list/nested write support |
| Schema arrives at runtime (tenant uploads, admin tools, GraphQL fragments) | **only option** | not applicable |
| Subset of fields varies per request | **fast** — `pick(names)` is one wasm call | works, same speed |
| Bundle-size sensitive (no per-schema codegen output) | **smaller** — one runtime, every schema | adds 2-3 KB per generated `.gen.mjs` |
| Production hot path | works — reads ~1.17× slower, batched picks slightly faster, writes ~1.6× slower | **faster** on per-field reads and writes |

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
r.pick(["name", "id"]);        // batched — one wasm call regardless of count
r.toObject();                  // every field in the schema
```

Three access modes:

- **`get(name)`**: single field, one wasm call. Use when you only want one or two values.
- **`pick(names)`**: batch read of an arbitrary subset, one wasm boundary call regardless of how many fields. Best for "I want fields A, B, and C" patterns.
- **`fields.name`**: Proxy. Each access calls `get` under the hood. Convenient but each access is a separate wasm call — use `pick` if reading 3+ fields.

## Writing

For the build side, the schema needs the struct's wire-format dimensions:

```js
const User = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  active: { kind: "bool",   bitOffset: 64 },
  name:   { kind: "text",   slot: 0 },
}, { dataWords: 2, ptrWords: 1 });

import { buildDynamic } from "capnwasm/dynamic";
const b = buildDynamic(cpp, User);
b.set("id", 42);
b.set("active", true);
b.set("name", "Alice");
const bytes = b.finalize();   // framed Cap'n Proto bytes
```

`dataWords` is the number of 8-byte words in the data section (covers all primitive + bool fields). `ptrWords` is the number of pointer slots (covers all text/data/list/struct fields). For schemas you've codegen'd, the values are `SomethingBuilder._DATA_WORDS` and `_PTR_WORDS`; for fresh schemas you compute them from the field offsets.

`finalize()` is one-shot — calling it twice throws.

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
| `struct` | `slot` + `schema` | nested object — runs `schema` recursively, returns plain object |
| `listStruct` | `slot` + `element` | array of objects — each element materialized via `element` schema |

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

## What's not in this pass

- **List builders** — wasm side doesn't expose a list-builder API yet.
- **Nested-struct builders** — same; would need a wasm-side `cpp_any_builder_enter_struct` to push the cursor.
- **Capability fields** — caps are server-managed identities, not data; capnwasm/dynamic is for plain data structs. RPC clients can still send caps via the codegen RPC layer.
- **Unions** — discriminant reading works (via the underlying `cpp_any_uint16_at`), but there's no friendly union API. Model unions as a `which` field plus per-variant fields and check `which` directly.

For these, codegen is the answer.
