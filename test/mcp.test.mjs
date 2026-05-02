// MCP / Anthropic tool definitions from a capnwasm manifest.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildManifest } from "../js/manifest.mjs";
import { manifestToTools } from "../js/mcp.mjs";

function capnpManifest() {
  return buildManifest(
    {
      structs: [
        // Method param/result structs are named "<method>$Params" / "$Results"
        // by the manifest builder — match capnpc's convention.
        {
          name: "getUser$Params",
          dataWords: 1,
          ptrWords: 0,
          fields: [
            { name: "id", ordinal: 0, type: "UInt64", kind: "data", bitOffset: 0 },
          ],
        },
        {
          name: "getUser$Results",
          dataWords: 0,
          ptrWords: 1,
          fields: [
            { name: "user", ordinal: 0, type: "User", kind: "pointer", ptrIndex: 0 },
          ],
        },
        {
          name: "User",
          dataWords: 1,
          ptrWords: 1,
          fields: [
            { name: "id", ordinal: 0, type: "UInt64", kind: "data", bitOffset: 0 },
            { name: "name", ordinal: 1, type: "Text", kind: "pointer", ptrIndex: 0 },
          ],
        },
      ],
      interfaces: [
        {
          name: "UserService",
          id: 0xabc123n,
          methods: [
            { name: "getUser", id: 0 },
          ],
        },
      ],
    },
    { source: { name: "users.capnp", format: "capnp" } },
  );
}

test("mcp: capnp method emits Anthropic-shaped tool", () => {
  const tools = manifestToTools(capnpManifest());
  assert.equal(tools.length, 1);
  const t = tools[0];
  assert.equal(t.name, "user_service_get_user");
  assert.match(t.description, /UserService\.getUser/);
  assert.equal(t.input_schema.type, "object");
  assert.deepEqual(t.input_schema.properties.id, {
    type: "string",
    pattern: "^\\d+$",
    description: "Unsigned 64-bit integer; pass as decimal string to preserve precision.",
  });
  assert.deepEqual(t.input_schema.required, ["id"]);
});

test("mcp: tool name fits Anthropic's regex", () => {
  const tools = manifestToTools(capnpManifest());
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/, `tool name ${t.name} fits Anthropic regex`);
  }
});

test("mcp: custom namer + describe", () => {
  const tools = manifestToTools(capnpManifest(), {
    namer: (op) => `tool_${op.methodName}`,
    describe: (op) => `does ${op.methodName} on ${op.interfaceName}`,
  });
  assert.equal(tools[0].name, "tool_getUser");
  assert.equal(tools[0].description, "does getUser on UserService");
});

test("mcp: nested struct reference becomes object schema (recursive)", () => {
  // Reuse the manifest where GetUserResults references User.
  const manifest = capnpManifest();
  // Override the params-struct lookup to point at User directly so the
  // recursion path through structToInputSchema fires.
  manifest.interfaces[0].methods.push({
    operationId: "UserService.updateUser",
    name: "updateUser",
    ordinal: 1,
    paramsStruct: "User",         // direct reference, not auto-generated
    resultsStruct: "getUser$Results",
    extensions: {},
  });
  const tools = manifestToTools(manifest);
  const t = tools.find(t => t.name === "user_service_update_user");
  assert.ok(t);
  assert.deepEqual(t.input_schema.properties.id, {
    type: "string",
    pattern: "^\\d+$",
    description: "Unsigned 64-bit integer; pass as decimal string to preserve precision.",
  });
  assert.deepEqual(t.input_schema.properties.name, { type: "string" });
});

test("mcp: empty params produces empty object schema", () => {
  const m = buildManifest(
    {
      structs: [],
      interfaces: [{
        name: "Pinger",
        id: 0x123n,
        methods: [{
          name: "ping",
          id: 0,
          paramsStruct: "missing$Params",
          resultsStruct: "missing$Results",
        }],
      }],
    },
    { source: { name: "p.capnp", format: "capnp" } },
  );
  const tools = manifestToTools(m);
  assert.deepEqual(tools[0].input_schema, {
    type: "object",
    properties: {},
    required: [],
  });
});

test("mcp: REST API method emits tool with HTTP-method-aware description", () => {
  const m = buildManifest(
    {
      restApis: [{
        name: "Petstore",
        methods: [{
          operationId: "Petstore.listPets",
          name: "listPets",
          httpMethod: "GET",
          path: "/pets",
          params: [
            { name: "limit", in: "query", type: "integer", required: false },
            { name: "tag",   in: "query", type: "string",  required: true  },
          ],
        }],
      }],
    },
    { source: { name: "petstore.yaml", format: "openapi" } },
  );
  const tools = manifestToTools(m);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "petstore_list_pets");
  assert.match(tools[0].description, /GET \/pets/);
  assert.deepEqual(tools[0].input_schema.properties.limit, { type: "integer" });
  assert.deepEqual(tools[0].input_schema.properties.tag, { type: "string" });
  assert.deepEqual(tools[0].input_schema.required, ["tag"]);
});

test("mcp: rejects non-manifest input", () => {
  assert.throws(() => manifestToTools(null), /must be a capnwasm manifest/);
  assert.throws(() => manifestToTools({}), /must be a capnwasm manifest/);
  assert.throws(() => manifestToTools({ manifestVersion: undefined, structs: [] }), /must be a capnwasm manifest/);
});

test("mcp: List(X) becomes array schema", () => {
  const m = buildManifest(
    {
      structs: [
        {
          name: "load$Params",
          fields: [
            { name: "ids", ordinal: 0, type: "List(UInt32)", kind: "pointer", ptrIndex: 0 },
            { name: "tags", ordinal: 1, type: "List(Text)", kind: "pointer", ptrIndex: 1 },
          ],
        },
      ],
      interfaces: [{
        name: "Loader",
        id: 0xff00n,
        methods: [{
          name: "load",
          id: 0,
        }],
      }],
      // Match the auto-generated naming the manifest builder applies.
      // Adding the params struct under the canonical name keeps the
      // structToInputSchema lookup happy.
      // (declared above in `structs`; we'll patch the test below)
    },
    { source: { name: "loader.capnp", format: "capnp" } },
  );
  const tools = manifestToTools(m);
  const t = tools[0];
  assert.equal(t.input_schema.properties.ids.type, "array");
  assert.equal(t.input_schema.properties.ids.items.type, "integer");
  assert.equal(t.input_schema.properties.tags.type, "array");
  assert.equal(t.input_schema.properties.tags.items.type, "string");
});
