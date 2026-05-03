// Manifest compatibility checker.
//
// `probe` answers: does today's live runtime still look like today's
// schema? This module answers a different question: if the manifest
// changes from A to B, would existing generated clients be surprised?
//
// The checker is intentionally conservative. It catches obvious API
// contract breaks (removed operations, changed paths, changed types,
// removed fields, newly-required params). It does not know business
// semantics, rollout policy, or whether a server keeps accepting an old
// input shape for compatibility.

import { createHash } from "node:crypto";

const BREAKING = "breaking";
const NON_BREAKING = "non-breaking";

export function fingerprintManifest(manifest) {
  return sha256(canonicalJson(contractView(manifest)));
}

export function diffManifests(previous, next, opts = {}) {
  const changes = [];
  const add = (severity, kind, path, message, before, after) => {
    changes.push({ severity, kind, path, message, before, after });
  };

  compareStructs(previous.structs ?? [], next.structs ?? [], add);
  compareInterfaces(previous.interfaces ?? [], next.interfaces ?? [], add);
  compareRestApis(previous.restApis ?? [], next.restApis ?? [], add);
  if (opts.openapi !== false) {
    compareOpenApiSchemas(
      previous.openapi?.components?.schemas ?? {},
      next.openapi?.components?.schemas ?? {},
      add,
    );
  }

  const summary = summarizeChanges(changes);
  return {
    previousFingerprint: fingerprintManifest(previous),
    nextFingerprint: fingerprintManifest(next),
    compatible: summary.breaking === 0,
    summary,
    changes,
  };
}

function compareStructs(prevStructs, nextStructs, add) {
  compareNamedMaps(prevStructs, nextStructs, {
    pathPrefix: "structs",
    removedKind: "struct.removed",
    addedKind: "struct.added",
    removedMessage: (name) => `struct ${name} was removed`,
    addedMessage: (name) => `struct ${name} was added`,
    onCommon: (name, prev, next) => compareFields(prev.fields ?? [], next.fields ?? [], `structs.${name}.fields`, add),
  }, add);
}

function compareFields(prevFields, nextFields, path, add) {
  compareNamedMaps(prevFields, nextFields, {
    pathPrefix: path,
    removedKind: "field.removed",
    addedKind: "field.added",
    removedMessage: (name) => `field ${name} was removed`,
    addedMessage: (name) => `field ${name} was added`,
    onCommon: (name, prev, next) => {
      if (prev.type !== next.type) {
        add(BREAKING, "field.typeChanged", `${path}.${name}.type`, `field ${name} type changed`, prev.type, next.type);
      }
      if (prev.ordinal !== next.ordinal) {
        add(BREAKING, "field.ordinalChanged", `${path}.${name}.ordinal`, `field ${name} ordinal changed`, prev.ordinal, next.ordinal);
      }
      if (prev.kind !== next.kind) {
        add(BREAKING, "field.kindChanged", `${path}.${name}.kind`, `field ${name} storage kind changed`, prev.kind, next.kind);
      }
    },
  }, add);
}

function compareInterfaces(prevIfaces, nextIfaces, add) {
  compareNamedMaps(prevIfaces, nextIfaces, {
    pathPrefix: "interfaces",
    removedKind: "interface.removed",
    addedKind: "interface.added",
    removedMessage: (name) => `interface ${name} was removed`,
    addedMessage: (name) => `interface ${name} was added`,
    onCommon: (name, prev, next) => {
      if (prev.id !== next.id) {
        add(BREAKING, "interface.idChanged", `interfaces.${name}.id`, `interface ${name} id changed`, prev.id, next.id);
      }
      compareNamedMaps(prev.methods ?? [], next.methods ?? [], {
        pathPrefix: `interfaces.${name}.methods`,
        removedKind: "method.removed",
        addedKind: "method.added",
        removedMessage: (methodName) => `method ${name}.${methodName} was removed`,
        addedMessage: (methodName) => `method ${name}.${methodName} was added`,
        onCommon: (methodName, prevMethod, nextMethod) => {
          const base = `interfaces.${name}.methods.${methodName}`;
          if (prevMethod.ordinal !== nextMethod.ordinal) {
            add(BREAKING, "method.ordinalChanged", `${base}.ordinal`, `method ${name}.${methodName} ordinal changed`, prevMethod.ordinal, nextMethod.ordinal);
          }
          if (prevMethod.paramsStruct !== nextMethod.paramsStruct) {
            add(BREAKING, "method.paramsChanged", `${base}.paramsStruct`, `method ${name}.${methodName} params struct changed`, prevMethod.paramsStruct, nextMethod.paramsStruct);
          }
          if (prevMethod.resultsStruct !== nextMethod.resultsStruct) {
            add(BREAKING, "method.resultsChanged", `${base}.resultsStruct`, `method ${name}.${methodName} results struct changed`, prevMethod.resultsStruct, nextMethod.resultsStruct);
          }
        },
      }, add);
    },
  }, add);
}

function compareRestApis(prevApis, nextApis, add) {
  compareNamedMaps(prevApis, nextApis, {
    pathPrefix: "restApis",
    removedKind: "restApi.removed",
    addedKind: "restApi.added",
    removedMessage: (name) => `REST API ${name} was removed`,
    addedMessage: (name) => `REST API ${name} was added`,
    onCommon: (name, prev, next) => compareRestMethods(prev.methods ?? [], next.methods ?? [], `restApis.${name}.methods`, add),
  }, add);
}

function compareRestMethods(prevMethods, nextMethods, path, add) {
  const prevById = mapBy(prevMethods, (m) => m.operationId ?? m.name);
  const nextById = mapBy(nextMethods, (m) => m.operationId ?? m.name);

  for (const [id, prev] of prevById) {
    const next = nextById.get(id);
    if (!next) {
      add(BREAKING, "operation.removed", `${path}.${id}`, `operation ${id} was removed`, briefRestMethod(prev), null);
      continue;
    }
    const base = `${path}.${id}`;
    if (prev.httpMethod !== next.httpMethod) {
      add(BREAKING, "operation.methodChanged", `${base}.httpMethod`, `operation ${id} HTTP method changed`, prev.httpMethod, next.httpMethod);
    }
    if (prev.path !== next.path) {
      add(BREAKING, "operation.pathChanged", `${base}.path`, `operation ${id} path changed`, prev.path, next.path);
    }
    if (prev.returnType !== next.returnType) {
      add(BREAKING, "operation.returnTypeChanged", `${base}.returnType`, `operation ${id} return type changed`, prev.returnType, next.returnType);
    }
    compareRestParams(prev.params ?? [], next.params ?? [], `${base}.params`, add);
  }

  for (const [id, next] of nextById) {
    if (!prevById.has(id)) {
      add(NON_BREAKING, "operation.added", `${path}.${id}`, `operation ${id} was added`, null, briefRestMethod(next));
    }
  }
}

function compareRestParams(prevParams, nextParams, path, add) {
  const prevByKey = mapBy(prevParams, restParamKey);
  const nextByKey = mapBy(nextParams, restParamKey);

  for (const [key, prev] of prevByKey) {
    const next = nextByKey.get(key);
    if (!next) {
      add(BREAKING, "param.removed", `${path}.${key}`, `parameter ${key} was removed`, briefParam(prev), null);
      continue;
    }
    if (prev.type !== next.type) {
      add(BREAKING, "param.typeChanged", `${path}.${key}.type`, `parameter ${key} type changed`, prev.type, next.type);
    }
    if (paramRequired(prev) !== paramRequired(next)) {
      const requiredNow = paramRequired(next);
      add(requiredNow ? BREAKING : NON_BREAKING, "param.requiredChanged", `${path}.${key}.required`, `parameter ${key} requiredness changed`, paramRequired(prev), requiredNow);
    }
  }

  for (const [key, next] of nextByKey) {
    if (!prevByKey.has(key)) {
      const required = paramRequired(next);
      add(required ? BREAKING : NON_BREAKING, "param.added", `${path}.${key}`, `parameter ${key} was added`, null, briefParam(next));
    }
  }
}

function compareOpenApiSchemas(prevSchemas, nextSchemas, add) {
  const prevNames = Object.keys(prevSchemas);
  const nextNames = Object.keys(nextSchemas);
  const nextSet = new Set(nextNames);
  const prevSet = new Set(prevNames);

  for (const name of prevNames) {
    if (!nextSet.has(name)) {
      add(BREAKING, "schema.removed", `openapi.components.schemas.${name}`, `OpenAPI schema ${name} was removed`, summarizeSchema(prevSchemas[name]), null);
    }
  }
  for (const name of nextNames) {
    if (!prevSet.has(name)) {
      add(NON_BREAKING, "schema.added", `openapi.components.schemas.${name}`, `OpenAPI schema ${name} was added`, null, summarizeSchema(nextSchemas[name]));
    }
  }
  for (const name of prevNames) {
    if (nextSet.has(name)) compareJsonSchema(prevSchemas[name], nextSchemas[name], `openapi.components.schemas.${name}`, add);
  }
}

function compareJsonSchema(prev, next, path, add) {
  if (!prev || !next || typeof prev !== "object" || typeof next !== "object") return;

  if (prev.$ref !== next.$ref) {
    add(BREAKING, "schema.refChanged", `${path}.$ref`, `schema reference changed`, prev.$ref ?? null, next.$ref ?? null);
  }
  if (prev.type !== next.type) {
    add(BREAKING, "schema.typeChanged", `${path}.type`, `schema type changed`, prev.type ?? null, next.type ?? null);
  }
  if (prev.format !== next.format) {
    add(BREAKING, "schema.formatChanged", `${path}.format`, `schema format changed`, prev.format ?? null, next.format ?? null);
  }
  if ((prev.nullable === true) !== (next.nullable === true)) {
    const nowNullable = next.nullable === true;
    add(nowNullable ? NON_BREAKING : BREAKING, "schema.nullableChanged", `${path}.nullable`, `schema nullability changed`, prev.nullable === true, nowNullable);
  }
  compareEnums(prev.enum, next.enum, `${path}.enum`, add);

  if (prev.type === "array" || next.type === "array") {
    compareJsonSchema(prev.items ?? {}, next.items ?? {}, `${path}.items`, add);
  }

  const prevProps = prev.properties ?? null;
  const nextProps = next.properties ?? null;
  if (prevProps || nextProps) {
    compareSchemaProperties(prevProps ?? {}, nextProps ?? {}, requiredSet(prev), requiredSet(next), `${path}.properties`, add);
  }

  compareAllOf(prev.allOf, next.allOf, `${path}.allOf`, add);
}

function compareSchemaProperties(prevProps, nextProps, prevRequired, nextRequired, path, add) {
  const prevNames = Object.keys(prevProps);
  const nextNames = Object.keys(nextProps);
  const nextSet = new Set(nextNames);
  const prevSet = new Set(prevNames);

  for (const name of prevNames) {
    if (!nextSet.has(name)) {
      add(BREAKING, "schema.propertyRemoved", `${path}.${name}`, `schema property ${name} was removed`, summarizeSchema(prevProps[name]), null);
      continue;
    }
    compareJsonSchema(prevProps[name], nextProps[name], `${path}.${name}`, add);
    if (prevRequired.has(name) !== nextRequired.has(name)) {
      const requiredNow = nextRequired.has(name);
      add(requiredNow ? BREAKING : NON_BREAKING, "schema.propertyRequiredChanged", `${path}.${name}.required`, `schema property ${name} requiredness changed`, prevRequired.has(name), requiredNow);
    }
  }

  for (const name of nextNames) {
    if (!prevSet.has(name)) {
      const required = nextRequired.has(name);
      add(required ? BREAKING : NON_BREAKING, "schema.propertyAdded", `${path}.${name}`, `schema property ${name} was added${required ? " as required" : ""}`, null, summarizeSchema(nextProps[name]));
    }
  }
}

function compareEnums(prevEnum, nextEnum, path, add) {
  if (!Array.isArray(prevEnum) && !Array.isArray(nextEnum)) return;
  const prev = new Set(prevEnum ?? []);
  const next = new Set(nextEnum ?? []);
  for (const v of prev) {
    if (!next.has(v)) add(BREAKING, "schema.enumValueRemoved", `${path}.${String(v)}`, `enum value ${String(v)} was removed`, v, null);
  }
  for (const v of next) {
    if (!prev.has(v)) add(NON_BREAKING, "schema.enumValueAdded", `${path}.${String(v)}`, `enum value ${String(v)} was added`, null, v);
  }
}

function compareAllOf(prevAllOf, nextAllOf, path, add) {
  if (!Array.isArray(prevAllOf) && !Array.isArray(nextAllOf)) return;
  const prev = prevAllOf ?? [];
  const next = nextAllOf ?? [];
  if (prev.length !== next.length) {
    add(BREAKING, "schema.allOfChanged", `${path}.length`, `allOf member count changed`, prev.length, next.length);
  }
  for (let i = 0; i < Math.min(prev.length, next.length); i++) {
    compareJsonSchema(prev[i], next[i], `${path}.${i}`, add);
  }
}

function compareNamedMaps(prevItems, nextItems, spec, add) {
  const prevByName = mapBy(prevItems, (x) => x.name);
  const nextByName = mapBy(nextItems, (x) => x.name);
  for (const [name, prev] of prevByName) {
    const next = nextByName.get(name);
    if (!next) {
      add(BREAKING, spec.removedKind, `${spec.pathPrefix}.${name}`, spec.removedMessage(name), shortValue(prev), null);
      continue;
    }
    spec.onCommon?.(name, prev, next);
  }
  for (const [name, next] of nextByName) {
    if (!prevByName.has(name)) {
      add(NON_BREAKING, spec.addedKind, `${spec.pathPrefix}.${name}`, spec.addedMessage(name), null, shortValue(next));
    }
  }
}

function mapBy(items, keyFn) {
  const out = new Map();
  for (const item of items ?? []) out.set(String(keyFn(item)), item);
  return out;
}

function restParamKey(param) {
  return `${param.in ?? param.role ?? "query"}:${param.wireName ?? param.name}`;
}

function paramRequired(param) {
  return param.required === true || param.optional === false;
}

function briefRestMethod(m) {
  return { httpMethod: m.httpMethod, path: m.path, returnType: m.returnType ?? null };
}

function briefParam(p) {
  return { name: p.name, in: p.in ?? p.role ?? "query", wireName: p.wireName ?? null, type: p.type ?? null, required: paramRequired(p) };
}

function summarizeSchema(schema) {
  if (!schema || typeof schema !== "object") return schema ?? null;
  const out = {};
  for (const k of ["$ref", "type", "format", "nullable", "enum"]) {
    if (schema[k] !== undefined) out[k] = schema[k];
  }
  if (schema.properties) out.properties = Object.keys(schema.properties);
  if (schema.required) out.required = schema.required;
  return out;
}

function requiredSet(schema) {
  return new Set(Array.isArray(schema?.required) ? schema.required : []);
}

function shortValue(value) {
  if (!value || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value;
  const out = {};
  for (const k of ["name", "id", "operationId", "ordinal", "type", "httpMethod", "path", "returnType"]) {
    if (value[k] !== undefined) out[k] = value[k];
  }
  return out;
}

function summarizeChanges(changes) {
  const summary = { total: changes.length, breaking: 0, nonBreaking: 0 };
  for (const c of changes) {
    if (c.severity === BREAKING) summary.breaking++;
    else if (c.severity === NON_BREAKING) summary.nonBreaking++;
  }
  return summary;
}

function contractView(manifest) {
  return {
    manifestVersion: manifest.manifestVersion ?? null,
    structs: manifest.structs ?? [],
    interfaces: manifest.interfaces ?? [],
    restApis: manifest.restApis ?? [],
    openapi: manifest.openapi ?? null,
  };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value) {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortForJson(value[key]);
  return out;
}
