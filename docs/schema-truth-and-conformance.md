# Schema checks and conformance limits

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time, but the current 0.0.x runtime still uses fixed scratch buffers, rejects messages larger than scratch capacity, ties readers to mutable wasm linear memory, and does not zero scratch memory after use. Treat it as a controlled demo, experiment, and small/medium payload prototype while production hardening continues.

> Learning notes from building capnwasm and studying schema-driven API
> tooling. This is not a platform proposal: it names the pieces this repo
> experiments with, the pieces it does not cover, and the gaps that still
> need human review or application-specific policy.

## A useful shape

One useful shape for schema-driven tooling looks like this:

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

One artifact, many surfaces. The goal is not that a tool magically makes
the API correct; the goal is that SDKs, docs, CLIs, examples, and tests
do not each invent a slightly different version of the same operation.

Most projects are not perfectly there. They have hand-rolled SDKs,
undocumented endpoints, schemas that lag the runtime, and generated
surfaces that drift from one another. The notes below are about where a
small tool like capnwasm can help, and where it cannot.

## The two structural gaps

### 1. Short/mid-term: schemas are not yet truthful

Getting schemas to match runtime behavior is not instant. You usually
cannot gate all progress on "fix every schema first," so an interim
audit loop is useful:

```
current (lying) schemas
   │
   ▼
audit / probe / compare / report drift
   │
   ▼
produce a concrete fix or review ask
   │
   ▼
regenerate surfaces; repeat
```

What that loop can surface, per operation:

- "This operation exists in the schema but fails at runtime."
- "This SDK method was generated but has no runnable example or test."
- "This endpoint has missing ownership, example, or version metadata."
- "This product has CLI coverage but no SDK coverage (or vice versa)."
- "This operation's runtime response shape has drifted from the schema."
- "This generated surface differs from the canonical operation manifest."

This is not only a generation problem. It is also a **conformance**
problem: "the schema says X; does the runtime actually do X?" That check
keeps generated surfaces from becoming a polished copy of stale input.

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

capnwasm is a small **schema → generated surfaces** experiment with a
real Cap'n Proto runtime compiled to WebAssembly. It is not a
platform-level schema-orchestration tool, not a manifest registry, and
not a policy engine. What it provides:

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
methods. The manifest maps closely to capnwasm's internal struct model,
so the same parsed operation shape can feed codegen, docs, tests, and
small review tools.

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

### Probe (today)

"Probe" here means a generated smoke/conformance check. It reads the
same operation manifest used for codegen, makes a synthetic request to
each declared operation, and records what was observable from the live
target. The narrow question is: **does the runtime still look compatible
with what the schema says?**

It is not a proof of correctness. It does not know business semantics,
it does not know which operations are safe to call unless the caller
provides that discipline, and it only checks what the transport exposes.

```bash
npx capnwasm manifest user.capnp -o user.manifest.json
npx capnwasm probe user.manifest.json --target ws://staging/rpc \
                                       --rest-target https://staging
```

Reads a manifest and a live target, exercises every operation, and
writes a structured JSON report (or stdout via `-o -`). The report has
one record per operation plus a summary count. Process exit code is `2`
when observable drift is found, so CI can gate on it if the target and
operation set are safe to call:

```bash
npx capnwasm probe user.manifest.json --rest-target $STAGING_URL
# exit 0 → all operations agreed with the schema
# exit 2 → at least one operation drifted; check the report
```

What it surfaces today:

- **REST**: HTTP status, content-type, observed top-level response
  keys (or first element's keys for arrays). When the manifest has a
  known object shape for the return type, it also reports missing and
  extra top-level keys. `outcome="error"` when the server returns
  4xx/5xx or the response body fails to JSON-parse.
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
For REST the keys are explicit, so top-level object drift is visible.
This is still not full JSON Schema validation: nested objects,
polymorphic responses, semantic invariants, and auth/permission behavior
belong in application tests.

### Compatibility diff (today)

The probe does **not** answer the versioning question. It compares one
manifest to one live target. To review an API contract shift, compare
the previous manifest to the proposed manifest instead:

```bash
npx capnwasm compat old.manifest.json new.manifest.json -o compat.report.json
# exit 0 → no breaking changes detected
# exit 2 → at least one breaking change detected
```

The compatibility report contains stable contract fingerprints plus a
changeset. The fingerprint ignores source metadata such as generation
time and file path; it hashes the contract surface: structs,
interfaces, REST operations, and the OpenAPI sidecar when present.

What `compat` flags as breaking today:

- Removed REST operations, changed paths or HTTP methods, changed return
  types, removed params, newly-required params, and param type changes.
- Removed Cap'n Proto interfaces/methods, changed interface IDs, changed
  method ordinals, and changed params/results struct names.
- Removed fields, changed field types, changed field ordinals, and
  changed field storage kind.
- Conservative OpenAPI object-schema changes: removed properties,
  changed property types, removed enum values, and newly-required
  properties.

What it treats as non-breaking:

- Added operations, added optional REST params, added fields, added
  schemas, added enum values, and loosening required/nullable flags.

This still is not rollout policy. If a breaking change is intentional,
the report gives reviewers the concrete changeset to discuss; it does
not decide whether a v2 endpoint, adapter, migration window, or major
version is the right response.

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

If the shape is "make schemas more accurate → generate surfaces from a
manifest → run checks against the output," capnwasm is a small proof of
some pieces of that loop: manifest export, codegen, compatibility diff,
contract harness, and runtime probe.

The parts it does not solve are the hard organizational ones: making the
source schemas accurate, deciding which operations are safe to probe,
choosing rollout policy for intentional breaks, and getting humans to
review changes in the owning codebase. The checks here are inputs to
that process, not replacements for it.

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
- ~~**Round-trip probe.**~~ **Done**. See `npx capnwasm probe`
  section above and `js/probe.mjs`. Reads manifest, exercises every
  operation against the live target, emits per-operation report with
  non-zero exit code on observable drift. REST gets top-level key
  comparison when a return shape is known; capnp gets call/decode
  success and field-readable accounting (with the wire-format limitation
  called out above).
  End-to-end coverage in `test/probe.test.mjs`.
- ~~**Manifest compatibility diff.**~~ **Done**. See `npx capnwasm compat`
  above and `js/compat.mjs`. Compares old/new manifests, emits stable
  fingerprints plus a conservative breaking/non-breaking changeset, and
  exits `2` when breaking changes are detected. Focused coverage in
  `test/compat.test.mjs`.

All four checking primitives landed: manifest → compat → harness → probe.
Together they move capnwasm from "schema generates SDK" toward
"schema generates SDK, proposed contract shifts can be reviewed before
release, the SDK has runnable contract checks, and a live target can be
smoke-checked for observable schema drift." The chain is one CLI
pipeline:

```bash
npx capnwasm manifest user.capnp -o user.manifest.json
npx capnwasm compat   old.manifest.json user.manifest.json
npx capnwasm harness  user.manifest.json --gen ./user.gen.mjs
npx capnwasm probe    user.manifest.json --target $RPC_URL
```

## Reading this against the rest of the docs

- [README](../README.md) is the runtime / SDK story: what capnwasm is,
  how to use it, where it wins and loses on perf.
- [vs-capnweb](vs-capnweb.md) is the per-workload comparison with the
  end-to-end render bench appended.
- This doc is the conformance framing: which checks capnwasm provides
  today, and which parts remain outside the tool.

The point of writing all three is the same: don't oversell, don't
under-claim, and make the gaps as visible as the wins.
