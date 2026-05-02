// MCP / Anthropic tool definitions from a capnwasm manifest.
//
// LLM agents need typed tool contracts. Anthropic's tool-use API and MCP
// servers both expect tool definitions shaped like:
//
//   {
//     name: "user_service_get_user",
//     description: "...",
//     input_schema: {
//       type: "object",
//       properties: { id: { type: "integer" } },
//       required: ["id"]
//     }
//   }
//
// This module converts a capnwasm manifest (capnp interfaces or REST
// APIs) into that shape. The schema is the source of truth. Agents
// see the same typed contract the rest of your stack does, with no
// ad-hoc JSON-tool wrangling.
//
//   import { manifestToTools } from "capnwasm/mcp";
//   const tools = manifestToTools(manifest);
//   // hand `tools` to anthropic.messages.create({ tools, ... })
//
// Or wire to an MCP server: the same `tools` array is what an MCP
// `list_tools` response returns; pair it with a `call_tool` handler that
// dispatches into your RpcSession (or REST runtime) using the manifest's
// operationId.

/**
 * Convert a capnwasm manifest into a flat array of tool definitions
 * compatible with Anthropic's tool-use API and the MCP spec.
 *
 * @param {object} manifest - output of buildManifest() / `npx capnwasm manifest`
 * @param {object} [opts]
 * @param {(name: string) => string} [opts.namer]
 *   Custom tool-name normalizer. Default: snake_case the operationId
 *   (e.g. "UserService.getUser" → "user_service_get_user"). Names must
 *   match `^[a-zA-Z0-9_-]{1,64}$` for Anthropic's API.
 * @param {(op: object) => string} [opts.describe]
 *   Custom description builder. Default: builds a short string from
 *   interface/method names.
 * @returns {Array<{name, description, input_schema}>}
 */
export function manifestToTools(manifest, opts = {}) {
  if (!manifest || typeof manifest !== "object" || !manifest.manifestVersion) {
    throw new Error("manifestToTools: argument must be a capnwasm manifest");
  }
  const namer = opts.namer ?? defaultNamer;
  const describe = opts.describe ?? defaultDescribe;
  const structIndex = indexStructs(manifest.structs ?? []);
  const tools = [];

  // Cap'n Proto interfaces. One tool per method.
  for (const iface of manifest.interfaces ?? []) {
    for (const method of iface.methods ?? []) {
      const op = {
        kind: "capnp",
        interfaceName: iface.name,
        interfaceId: iface.id,
        methodName: method.name,
        methodOrdinal: method.ordinal,
        operationId: method.operationId,
        paramsStructName: method.paramsStruct,
        resultsStructName: method.resultsStruct,
      };
      tools.push({
        name: namer(op),
        description: describe(op),
        input_schema: structToInputSchema(method.paramsStruct, structIndex),
      });
    }
  }

  // REST APIs. One tool per method.
  for (const api of manifest.restApis ?? []) {
    for (const method of api.methods ?? []) {
      const op = {
        kind: "rest",
        apiName: api.name,
        methodName: method.name,
        operationId: method.operationId ?? `${api.name}.${method.name}`,
        httpMethod: method.httpMethod,
        path: method.path,
        params: method.params ?? [],
      };
      tools.push({
        name: namer(op),
        description: describe(op),
        input_schema: restMethodToInputSchema(method),
      });
    }
  }

  return tools;
}

function indexStructs(structs) {
  const ix = new Map();
  for (const s of structs) ix.set(s.name, s);
  return ix;
}

function structToInputSchema(structName, structIndex) {
  const s = structIndex.get(structName);
  if (!s) {
    // Params struct missing from manifest (e.g. a method with no params
    // doesn't always emit a $Params struct). Empty object is the right
    // default. Agents see a no-arg tool.
    return { type: "object", properties: {}, required: [] };
  }
  const properties = {};
  const required = [];
  for (const f of s.fields ?? []) {
    properties[f.name] = capnpTypeToJsonSchema(f, structIndex);
    // Cap'n Proto has no nullable concept. Every field has a default
    // value (zero / "" / empty list). Treat all as required for the
    // strictest agent contract; consumers can post-process if they
    // want optionality semantics.
    required.push(f.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function restMethodToInputSchema(method) {
  // OpenAPI / @rest method params are already JSON-shaped. Surface them
  // as-is. method.params is an array of { name, in, type, required }.
  const properties = {};
  const required = [];
  for (const p of method.params ?? []) {
    properties[p.name] = openApiParamToJsonSchema(p);
    if (p.required) required.push(p.name);
  }
  // Some REST methods carry a body. Fold in its top-level properties.
  if (method.body && typeof method.body === "object") {
    if (method.body.properties) {
      for (const [k, v] of Object.entries(method.body.properties)) {
        properties[k] = v;
      }
      for (const r of method.body.required ?? []) required.push(r);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: dedupe(required) } : {}),
  };
}

function dedupe(arr) {
  return [...new Set(arr)];
}

function openApiParamToJsonSchema(p) {
  // OpenAPI spec already provides JSON-Schema-shaped types; pass through
  // when present, otherwise infer from the type field.
  if (p.schema && typeof p.schema === "object") return p.schema;
  switch (p.type) {
    case "string":  return { type: "string" };
    case "integer": return { type: "integer" };
    case "number":  return { type: "number" };
    case "boolean": return { type: "boolean" };
    case "array":   return { type: "array", items: p.items ?? {} };
    case "object":  return { type: "object" };
    default:        return {};
  }
}

function capnpTypeToJsonSchema(field, structIndex) {
  const t = field.type;
  switch (t) {
    case "Bool":    return { type: "boolean" };
    case "Int8":    return { type: "integer", minimum: -128, maximum: 127 };
    case "UInt8":   return { type: "integer", minimum: 0, maximum: 255 };
    case "Int16":   return { type: "integer", minimum: -32768, maximum: 32767 };
    case "UInt16":  return { type: "integer", minimum: 0, maximum: 65535 };
    case "Int32":   return { type: "integer", minimum: -2147483648, maximum: 2147483647 };
    case "UInt32":  return { type: "integer", minimum: 0, maximum: 4294967295 };
    case "Int64":   return { type: "string", pattern: "^-?\\d+$", description: "Signed 64-bit integer; pass as decimal string to preserve precision." };
    case "UInt64":  return { type: "string", pattern: "^\\d+$",   description: "Unsigned 64-bit integer; pass as decimal string to preserve precision." };
    case "Float32":
    case "Float64": return { type: "number" };
    case "Text":    return { type: "string" };
    case "Data":    return { type: "string", contentEncoding: "base64" };
    default: {
      // List(X) or a struct reference. Manifest emits the type as a
      // string so we sniff the prefix.
      if (typeof t === "string" && t.startsWith("List(")) {
        const inner = t.slice("List(".length, -1);
        return {
          type: "array",
          items: capnpTypeToJsonSchema({ type: inner }, structIndex),
        };
      }
      // Nested struct reference: recurse into its fields if we have it.
      if (typeof t === "string" && structIndex.has(t)) {
        return structToInputSchema(t, structIndex);
      }
      // Unknown. Leave loosely typed so the agent at least sees the field.
      return {};
    }
  }
}

function defaultNamer(op) {
  // Anthropic tool names: ^[a-zA-Z0-9_-]{1,64}$. Snake_case the operationId.
  // "UserService.getUser" → "user_service_get_user"
  // "Petstore.listPets"   → "petstore_list_pets"
  const id = op.operationId;
  const snake = id
    .replace(/\./g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase();
  return snake.slice(0, 64);
}

function defaultDescribe(op) {
  if (op.kind === "capnp") {
    return `Cap'n Proto RPC: ${op.interfaceName}.${op.methodName} (interface ${op.interfaceId}, method ordinal ${op.methodOrdinal}).`;
  }
  return `${op.httpMethod ?? "GET"} ${op.path ?? ""}. ${op.apiName}.${op.methodName}`;
}
