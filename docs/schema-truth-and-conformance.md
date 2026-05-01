# Schema truth and conformance: where capnwasm fits

> Long-term thinking on schemas, generated SDKs, and runtime
> conformance — and an honest read on which pieces capnwasm provides,
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

This isn't a generation problem. It's a **conformance** problem —
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

The `.ts` and OpenAPI inputs feed the same model — REST clients
generate from `@rest`-annotated TypeScript interfaces or from OpenAPI
YAML, with the same internal representation as `.capnp`-derived RPC
methods. The "manifest" in the long-term plan above maps almost 1:1
onto capnwasm's internal struct model — codegen, codegen, codegen, all
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
descended from the same source — by construction, not by audit.

### What capnwasm does NOT provide

Honest list, because pretending it covers more than it does is the
trap this whole framing is meant to avoid:

- **No drift audit.** capnwasm doesn't compare a `.capnp` schema
  against a running endpoint and tell you "your `getUser` actually
  returns an extra field that's not in the schema." That requires a
  probe-the-runtime layer that doesn't exist here.
- **No operation manifest export.** The internal struct model is
  not currently emitted as a JSON manifest you could feed to other
  generators. (Could be added — the model is already a plain JS
  object during codegen.)
- **No generated contract tests.** Generated SDKs come with type
  definitions but not with "and here's a runnable test that exercises
  every method against a mock server generated from the same schema."
  This is the most direct way capnwasm could close the
  "SDK-isn't-runnable" gap.
- **No safe-to-test flag.** Operations are typed but not tagged with
  "this is a read-only safe-to-poke endpoint" vs "this mutates
  production." A real audit/probe loop needs this.
- **No multi-language SDK from one source.** capnwasm generates
  TypeScript/JavaScript clients. The Cap'n Proto schema itself is
  language-portable (the upstream toolchain has C++/Rust/Go/Python
  generators), but capnwasm doesn't bundle those. If your platform
  needs four SDKs, you use capnwasm for the JS one and the upstream
  generators for the others — both backed by the same `.capnp`.

## Where this points

If the long-term plan is "make schemas truthful → generate every
surface from the manifest → ship everything fast," capnwasm is a
working proof point for the **last two thirds of the pipeline**: the
generation step (one schema → typed clients, runtime, dynamic readers)
and the conformance guarantee (the same C++ runtime everywhere, no
schema/runtime drift by construction).

The first third — making the upstream schemas truthful, building the
audit loop, generating runnable contract tests — is where the
ecosystem still needs work. The schema-as-truth thesis only pays off
when the schemas actually are true; until then you need the audit
layer to surface the lies and a contract harness to keep new
generations honest.

For capnwasm specifically, the obvious next steps that would tighten
the conformance story:

- **Emit the operation manifest as JSON.** The internal struct/method
  model already exists during codegen. Exposing it as a stable schema
  artifact would let other tools (drift detectors, doc generators,
  MCP servers, mock generators) consume it without re-parsing
  `.capnp` themselves.
- **Generate a contract test harness from the schema.** For each
  generated method, emit a default "happy-path" round-trip test that
  the consuming app can wire to a real or mock server. The mock can
  be generated from the same schema using the dynamic builder (a
  capability that's already there for the runtime-schema reader).
- **Round-trip drift probe.** Given a `.capnp` schema and a live
  endpoint, `capnwasm probe` could call each method with synthesized
  params and report any reply field that the schema doesn't declare,
  or any expected field the endpoint doesn't return. This is the
  "schema says X; runtime actually does X?" check, narrowed to one
  service at a time.

None of those are landed yet. They'd be the right next chunk of work
if the goal is to push capnwasm from "a schema-first runtime" toward
"a schema-first conformance harness." The infrastructure to do them is
all in place — the codegen model, the dynamic builder, the wasm-hosted
schema compiler — what's missing is the surface layer that makes them
runnable from the CLI and reportable from CI.

## Reading this against the rest of the docs

- [README](../README.md) is the runtime / SDK story: what capnwasm is,
  how to use it, where it wins and loses on perf.
- [vs-capnweb](vs-capnweb.md) is the per-workload comparison with the
  end-to-end render bench appended.
- This doc is the long-term framing — what an honest schema-as-truth
  pipeline looks like and which pieces capnwasm provides today.

The point of writing all three is the same: don't oversell, don't
under-claim, and make the gaps as visible as the wins.
