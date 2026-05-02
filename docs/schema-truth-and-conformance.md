# Schema truth and conformance: where capnwasm fits

> Long-term thinking on schemas, generated SDKs, and runtime
> conformance. And an honest read on which pieces capnwasm provides,
> which it doesn't, and which gaps still need someone to build.

## The long-term shape

The end state for a healthy multi-surface API platform looks like this:

```
truthful upstream schemas
   │
   ▼
operation manifest (machine-readable, canonical)
   │
   ├─► TypeScript SDK
   ├─► Go SDK
   ├─► Python SDK
   ├─► CLI
   ├─► docs site
   ├─► MCP server
   └─► generated tests / contract suite
```

One artifact, many surfaces. No surface is hand-written. No surface
disagrees with another about what an operation is, what arguments it
takes, what it returns, who owns it, when it deprecates.

That's the destination. Most orgs are not there. Most orgs have
hand-rolled SDKs, undocumented endpoints, schemas that lie about what
the runtime actually does, and CLIs that drift from the SDKs that
drift from the docs.

## The two structural gaps

### 1. Short/mid-term: schemas are not yet truthful

Getting 100+ teams to make their schemas truthful is not instant.
You can't gate the migration on "everyone fixes their schema first"
because then nothing ships. So there has to be an interim audit loop:

```
current (lying) schemas
   │
   ▼
audit / probe / compare / report drift
   │
   ▼
tell teams exactly what to fix
   │
   ▼
regenerate surfaces; repeat
```

What that audit loop has to surface, per operation:

- "This operation exists in the schema but fails at runtime."
- "This SDK method was generated but has no runnable example or test."
- "This endpoint has missing ownership / git URL / version metadata."
- "This product has CLI coverage but no SDK coverage (or vice versa)."
- "This operation's runtime response shape has drifted from the schema."
- "This generated surface differs from the canonical operation manifest."

This isn't a generation problem. It's a **conformance** problem -
"the schema says X; does the runtime actually do X?" Conformance is
what makes the rest of the pipeline trustworthy.

### 2. SDKs aren't runnable, by themselves

An SDK is a library, not a system. Its existence proves nothing
about correctness. To make an SDK trustworthy you need one of:

- SDK + generated examples that run against staging / prod / a local
  mirror.
- SDK + generated contract tests against a mock server generated from
  the schema.
- SDK + generated smoke tests using safe read-only API calls.

The *runnable thing* is the test harness. Not the SDK. An SDK that
ships without one of these three is an unverified claim.

## Where capnwasm fits

capnwasm is the **schema → generated surfaces** piece, with
**wire-format conformance baked in**. It is not a platform-level schema-orchestration tool,
not a manifest registry, not an audit tool. What it provides:

### One schema, multiple typed surfaces (today)

```
.capnp schema
   │
   ▼
bin/capnwasm.mjs (CLI)
   │
   ├─► typed JS Reader / Builder (zero-copy, codegen)
   ├─► RPC client + server (Cap'n Proto rpc.capnp wire)
   ├─► dynamic runtime reader (no codegen, schema-as-data)
   ├─► .d.ts declarations (TypeScript types)
   └─► (planned: contract test harness)
```

The `.ts` and OpenAPI inputs feed the same model. REST clients
generate from `@rest`-annotated TypeScript interfaces or from OpenAPI
YAML, with the same internal representation as `.capnp`-derived RPC
methods. The "manifest" in the long-term plan above maps almost 1:1
onto capnwasm's internal struct model. Codegen, codegen, codegen, all
from one source of truth.

### Wire-format conformance (today)

This is the unusual one. capnwasm doesn't have a JS reimplementation
of Cap'n Proto wire format. It has **the actual upstream C++ runtime**
compiled to WebAssembly via `zig cc`. The decoder in your browser is
the same code path as the decoder in a C++ service.

What this means concretely: there is no wire format the C++ ref
implementation accepts but capnwasm rejects (or vice versa), because
they are the same implementation. The conformance test suite
(`test/conformance.test.mjs`, `cpp/conformance_schema.capnp`) tests
this explicitly: every wire pattern that the C++ test corpus accepts
is round-tripped through capnwasm and bit-compared.

That's a different kind of guarantee than "this SDK was generated
from a schema and we hope it agrees with the runtime." For
**capnwasm-generated clients talking to any Cap'n Proto peer**, the
schema, the wire format, the decoder, and the encoder are all
descended from the same source. By construction, not by audit.

### Operation manifest export (today)

```bash
npx capnwasm manifest user.capnp                  # → user.manifest.json
npx capnwasm manifest stripe.json -o stripe.json  # OpenAPI source
npx capnwasm manifest api.ts -o -                 # stdout (TS @rest source)
```

One canonical JSON envelope across all three input formats. Same
shape whether the source is `.capnp`, a `@rest`-annotated TypeScript
interface, or an OpenAPI spec. Downstream tools (drift detectors,
mock generators, doc generators, MCP servers, contract test
harnesses) only ever have to implement one parser:

```json
{
  "manifestVersion": 1,
  "source": { "name": "user.capnp", "format": "capnp",
              "generatedAt": "2026-05-01T..." },
  "metadata": {},
  "structs": [
    {
      "name": "User",
      "dataWords": 3, "ptrWords": 3,
      "fields": [
        { "name": "id", "ordinal": 0, "type": "UInt64",
          "kind": "data", "bitOffset": 0 },
        { "name": "name", "ordinal": 1, "type": "Text",
          "kind": "pointer", "ptrIndex": 0 }
      ]
    }
  ],
  "interfaces": [
    {
      "name": "UserService", "id": "0xb86ba78412905b27",
      "methods": [
        { "operationId": "UserService.getUser",
          "name": "getUser", "ordinal": 0,
          "paramsStruct": "getUser$Params",
          "resultsStruct": "getUser$Results",
          "extensions": {} }
      ]
    }
  ],
  "restApis": [
    {
      "name": "MyAPI", "baseUrl": "https://api.example.com",
      "defaults": { "auth": { "type": "bearer" } },
      "methods": [
        { "operationId": "MyAPI.getUser",
          "name": "getUser", "httpMethod": "GET",
          "path": "/users/{id}",
          "params": [{ "name": "id", "in": "path",
                       "type": "number", "required": true }],
          "returnType": "User",
          "extensions": {} }
      ]
    }
  ]
}
```

`extensions` and `metadata` are deliberately free-form so future
@-directives can plumb owner team, repo URL, examples, deprecation
flags, safe-to-test flags, and so on without bumping
`manifestVersion`. Interface IDs are normalized to lowercase
`0x`-prefixed hex strings. Not numbers. So JS consumers don't lose
precision on 64-bit IDs greater than 2^53.

### Generated contract test harness (today)

```bash
npx capnwasm manifest user.capnp -o user.manifest.json
npx capnwasm harness user.manifest.json --gen ./user.gen.mjs -o user.contract.test.mjs
node --test user.contract.test.mjs
```

Reads a manifest and emits a runnable Node `--test` file. Every capnp
RPC method gets a test that exercises it end-to-end against an
in-process mock server (default: paired-memory transport with
default-response handlers built from the manifest itself. Zero
infrastructure). Override the target to run against a real endpoint:

```bash
CAPNWASM_HARNESS_TARGET=ws://staging.example.com/rpc \
  node --test user.contract.test.mjs
```

REST methods land in the same harness file but need an explicit
target (a generic mock REST server can't be synthesized from a
manifest. OpenAPI declares response shapes, not values, and arbitrary
handler logic is out of scope for a manifest):

```bash
CAPNWASM_HARNESS_REST_TARGET=https://staging.example.com \
  node --test user.contract.test.mjs
```

What the harness asserts: each operation is callable, request encodes,
response decodes against the declared result schema. What it does
**not** assert: business semantics. Those belong in your app's own
tests; the harness is the safety net that catches "you renamed a
field and forgot to update the SDK consumers" before code review does.

The emitted file is a normal test fixture meant to be checked in to
the consuming app's repo. That keeps the contract surface visible in
the app's test output (and PR diffs when the schema changes), instead
of being hidden inside a tooling subprocess.

### Drift probe (today)

```bash
npx capnwasm manifest user.capnp -o user.manifest.json
npx capnwasm probe user.manifest.json --target ws://staging/rpc \
                                       --rest-target https://staging
```

Reads a manifest and a live target, exercises every operation,
reports what the runtime actually did vs what the schema declared.
Output is structured JSON (or stdout via `-o -`), with a per-operation
record and a summary count. Process exit code is `2` when any
operation drifts, so CI can gate on it:

```bash
npx capnwasm probe user.manifest.json --rest-target $STAGING_URL
# exit 0 → all operations agreed with the schema
# exit 2 → at least one operation drifted; check the report
```

What it surfaces:

- **REST**: HTTP status, content-type, observed top-level response
  keys (or first element's keys for arrays). `outcome="error"` when
  the server returns 4xx/5xx or the response body fails to JSON-parse.
- **Capnp**: call success / failure (with the exception message),
  declared-vs-readable field accounting (which fields the manifest
  said exist, which actually decoded without throwing), and request
  + response wire byte counts.

Honest about what capnp drift detection **can't** tell you: capnp
messages are positional (no field names on the wire), so a field
that comes back as its zero value is indistinguishable from a field
the runtime didn't send. Detecting "extra fields the runtime sent
that the schema doesn't know about" requires either a newer schema
to compare against or a wire-byte audit beyond the probe's scope.
For REST the keys are explicit so the diff is full.

### What capnwasm does NOT provide

Honest list, because pretending it covers more than it does is the
trap this whole framing is meant to avoid:
- **No safe-to-test flag.** Operations are typed but not tagged with
  "this is a read-only safe-to-poke endpoint" vs "this mutates
  production." A real audit/probe loop needs this.
- **No multi-language SDK from one source.** capnwasm generates
  TypeScript/JavaScript clients. The Cap'n Proto schema itself is
  language-portable (the upstream toolchain has C++/Rust/Go/Python
  generators), but capnwasm doesn't bundle those. If your platform
  needs four SDKs, you use capnwasm for the JS one and the upstream
  generators for the others. Both backed by the same `.capnp`.

## Where this points

If the long-term plan is "make schemas truthful → generate every
surface from the manifest → ship everything fast," capnwasm is a
working proof point for the **last two thirds of the pipeline**: the
generation step (one schema → typed clients, runtime, dynamic readers)
and the conformance guarantee (the same C++ runtime everywhere, no
schema/runtime drift by construction).

The first third. Making the upstream schemas truthful, building the
audit loop, generating runnable contract tests. Is where the
ecosystem still needs work. The schema-as-truth thesis only pays off
when the schemas actually are true; until then you need the audit
layer to surface the lies and a contract harness to keep new
generations honest.

For capnwasm specifically, the obvious next steps that would tighten
the conformance story:

- ~~**Emit the operation manifest as JSON.**~~ **Done**. See the
  `npx capnwasm manifest` section above and `js/manifest.mjs`. One
  shape across `.capnp`, TypeScript `@rest`, and OpenAPI sources;
  consumed by the harness without re-parsing source schemas.
- ~~**Generate a contract test harness from the schema.**~~ **Done** -
  see `npx capnwasm harness` above and `js/harness.mjs`. Capnp RPC
  methods get an in-process-mock test by default (zero infra), or
  point at a real WS endpoint via `CAPNWASM_HARNESS_TARGET`. REST
  methods need a real target via `CAPNWASM_HARNESS_REST_TARGET`.
  Generated tests are runnable with `node --test` and pass against
  the in-process mock today (see `test/harness.test.mjs` for the
  end-to-end smoke).
- ~~**Round-trip drift probe.**~~ **Done**. See `npx capnwasm probe`
  section above and `js/probe.mjs`. Reads manifest, exercises every
  operation against the live target, emits per-operation drift report
  with non-zero exit code on any drift (CI-gateable). REST gets full
  key-level diff; capnp gets call/decode success and field-readable
  accounting (with the wire-format limitation called out above).
  End-to-end coverage in `test/probe.test.mjs`.

All three schema-truth follow-ups landed: manifest → harness → probe.
Together they push capnwasm's conformance surface from "schema
generates SDK" to "schema generates SDK, the SDK is verifiably
runnable against the schema, and the running endpoint is verifiably
agreeing with the schema." The chain is one CLI pipeline:

```bash
npx capnwasm manifest user.capnp -o user.manifest.json
npx capnwasm harness  user.manifest.json --gen ./user.gen.mjs
npx capnwasm probe    user.manifest.json --target $RPC_URL
```

## Reading this against the rest of the docs

- [README](../README.md) is the runtime / SDK story: what capnwasm is,
  how to use it, where it wins and loses on perf.
- [vs-capnweb](vs-capnweb.md) is the per-workload comparison with the
  end-to-end render bench appended.
- This doc is the long-term framing. What an honest schema-as-truth
  pipeline looks like and which pieces capnwasm provides today.

The point of writing all three is the same: don't oversell, don't
under-claim, and make the gaps as visible as the wins.
