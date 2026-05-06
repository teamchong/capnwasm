// Extract a slim endpoint index from the Cloudflare OpenAPI spec for
// the /playground globe demo. The full spec is 9.2 MB and contains
// schemas / metadata we don't need for the demo; this script trims it
// to roughly 1–2 MB of just-what-we-need-for-the-page.
//
// Output: web/public/data/cf-endpoints.json
//
// Shape:
//   {
//     generatedAt: "ISO-8601",
//     stats: { paths, operations, tags },
//     pops: [{ city, country, lat, lng }],
//     endpoints: [
//       {
//         id:      "accounts-list-accounts",
//         path:    "/accounts",
//         method:  "GET",
//         tag:     "Accounts",       // first declared tag
//         summary: "List accounts",
//         lat:     51.5074,           // assigned PoP
//         lng:     -0.1278,
//         params:  [{ name, in, type, required }],
//         mock:    {  ...sensible mock response from spec example or schema  },
//       },
//       …
//     ]
//   }
//
// PoP placement: each endpoint hashes deterministically to one of
// Cloudflare's published colos (London, IAD, FRA, SIN, …) so dots
// cluster at real-world locations instead of scattering across oceans.
//
// Mock responses: prefer the spec's `example` or `examples`; otherwise
// synthesize from the schema (resolving $ref) using a small faker that
// looks at field name + type to pick a plausible value.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const FIXTURE = resolve(REPO, "test/_fixtures/cloudflare-openapi.json");
const OUT_DIR = resolve(HERE, "..", "public", "data");
const OUT = resolve(OUT_DIR, "cf-endpoints.json");

const FETCH_HINT = `Run this once to download the schema:
  curl -sL https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json \\
       -o test/_fixtures/cloudflare-openapi.json`;

if (!existsSync(FIXTURE)) {
  console.error(`build-globe-data: fixture not found: ${FIXTURE}`);
  console.error(FETCH_HINT);
  console.error("Skipping; the globe page will fall back to a built-in sample.");
  process.exit(0);
}

// Cloudflare PoPs (a curated subset; the real list is 300+ but for
// visual placement we want a smaller set that reads cleanly on a globe).
// Lat/lng are city centroids, not exact data-center coordinates.
const POPS = [
  { city: "Amsterdam",     country: "NL", lat: 52.3676, lng: 4.9041   },
  { city: "Atlanta",       country: "US", lat: 33.7490, lng: -84.3880 },
  { city: "Auckland",      country: "NZ", lat: -36.8485, lng: 174.7633 },
  { city: "Bangalore",     country: "IN", lat: 12.9716, lng: 77.5946  },
  { city: "Berlin",        country: "DE", lat: 52.5200, lng: 13.4050  },
  { city: "Buenos Aires",  country: "AR", lat: -34.6037, lng: -58.3816 },
  { city: "Cairo",         country: "EG", lat: 30.0444, lng: 31.2357  },
  { city: "Cape Town",     country: "ZA", lat: -33.9249, lng: 18.4241 },
  { city: "Chennai",       country: "IN", lat: 13.0827, lng: 80.2707  },
  { city: "Chicago",       country: "US", lat: 41.8781, lng: -87.6298 },
  { city: "Dallas",        country: "US", lat: 32.7767, lng: -96.7970 },
  { city: "Denver",        country: "US", lat: 39.7392, lng: -104.9903 },
  { city: "Dubai",         country: "AE", lat: 25.2048, lng: 55.2708  },
  { city: "Dublin",        country: "IE", lat: 53.3498, lng: -6.2603  },
  { city: "Frankfurt",     country: "DE", lat: 50.1109, lng: 8.6821   },
  { city: "Hong Kong",     country: "HK", lat: 22.3193, lng: 114.1694 },
  { city: "Istanbul",      country: "TR", lat: 41.0082, lng: 28.9784  },
  { city: "Jakarta",       country: "ID", lat: -6.2088, lng: 106.8456 },
  { city: "Johannesburg",  country: "ZA", lat: -26.2041, lng: 28.0473 },
  { city: "Lagos",         country: "NG", lat: 6.5244, lng: 3.3792    },
  { city: "Lima",          country: "PE", lat: -12.0464, lng: -77.0428 },
  { city: "London",        country: "GB", lat: 51.5074, lng: -0.1278  },
  { city: "Los Angeles",   country: "US", lat: 34.0522, lng: -118.2437 },
  { city: "Madrid",        country: "ES", lat: 40.4168, lng: -3.7038  },
  { city: "Manila",        country: "PH", lat: 14.5995, lng: 120.9842 },
  { city: "Melbourne",     country: "AU", lat: -37.8136, lng: 144.9631 },
  { city: "Mexico City",   country: "MX", lat: 19.4326, lng: -99.1332 },
  { city: "Miami",         country: "US", lat: 25.7617, lng: -80.1918 },
  { city: "Milan",         country: "IT", lat: 45.4642, lng: 9.1900   },
  { city: "Montreal",      country: "CA", lat: 45.5017, lng: -73.5673 },
  { city: "Moscow",        country: "RU", lat: 55.7558, lng: 37.6173  },
  { city: "Mumbai",        country: "IN", lat: 19.0760, lng: 72.8777  },
  { city: "Nairobi",       country: "KE", lat: -1.2921, lng: 36.8219  },
  { city: "New Delhi",     country: "IN", lat: 28.6139, lng: 77.2090  },
  { city: "New York",      country: "US", lat: 40.7128, lng: -74.0060 },
  { city: "Osaka",         country: "JP", lat: 34.6937, lng: 135.5023 },
  { city: "Paris",         country: "FR", lat: 48.8566, lng: 2.3522   },
  { city: "Reykjavik",     country: "IS", lat: 64.1466, lng: -21.9426 },
  { city: "Rio de Janeiro",country: "BR", lat: -22.9068, lng: -43.1729 },
  { city: "San Francisco", country: "US", lat: 37.7749, lng: -122.4194 },
  { city: "San Jose",      country: "CR", lat: 9.9281, lng: -84.0907  },
  { city: "Santiago",      country: "CL", lat: -33.4489, lng: -70.6693 },
  { city: "Sao Paulo",     country: "BR", lat: -23.5505, lng: -46.6333 },
  { city: "Seattle",       country: "US", lat: 47.6062, lng: -122.3321 },
  { city: "Seoul",         country: "KR", lat: 37.5665, lng: 126.9780 },
  { city: "Shanghai",      country: "CN", lat: 31.2304, lng: 121.4737 },
  { city: "Singapore",     country: "SG", lat: 1.3521, lng: 103.8198  },
  { city: "Stockholm",     country: "SE", lat: 59.3293, lng: 18.0686  },
  { city: "Sydney",        country: "AU", lat: -33.8688, lng: 151.2093 },
  { city: "Taipei",        country: "TW", lat: 25.0330, lng: 121.5654 },
  { city: "Tel Aviv",      country: "IL", lat: 32.0853, lng: 34.7818  },
  { city: "Tokyo",         country: "JP", lat: 35.6762, lng: 139.6503 },
  { city: "Toronto",       country: "CA", lat: 43.6511, lng: -79.3470 },
  { city: "Vancouver",     country: "CA", lat: 49.2827, lng: -123.1207 },
  { city: "Vienna",        country: "AT", lat: 48.2082, lng: 16.3738  },
  { city: "Warsaw",        country: "PL", lat: 52.2297, lng: 21.0122  },
  { city: "Washington DC", country: "US", lat: 38.9072, lng: -77.0369 },
  { city: "Zurich",        country: "CH", lat: 47.3769, lng: 8.5417   },
];

// FNV-1a 32-bit hash. Stable across runs; deterministic placement.
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function popFor(operationKey) {
  return POPS[hash32(operationKey) % POPS.length];
}

// ---- Schema $ref resolution + faker ------------------------------------

function resolveRef(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = spec;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur ?? null;
}

function fakeValue(name, schema, spec, depth = 0) {
  // Bail out of cycles. Cloudflare schemas have indirection through
  // `result` envelopes that can recurse forever otherwise.
  if (depth > 6) return null;
  if (!schema || typeof schema !== "object") return null;

  if (typeof schema.$ref === "string") {
    const target = resolveRef(spec, schema.$ref);
    return fakeValue(name, target, spec, depth + 1);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      const r = part.$ref ? resolveRef(spec, part.$ref) : part;
      if (!r) continue;
      if (r.properties) Object.assign(merged.properties, r.properties);
      if (r.required) merged.required.push(...r.required);
    }
    return fakeValue(name, merged, spec, depth + 1);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return fakeValue(name, schema.oneOf[0], spec, depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return fakeValue(name, schema.anyOf[0], spec, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  switch (t) {
    case "object": {
      const out = {};
      const props = schema.properties ?? {};
      for (const [k, v] of Object.entries(props)) {
        out[k] = fakeValue(k, v, spec, depth + 1);
      }
      return out;
    }
    case "array": {
      const item = fakeValue(name, schema.items ?? {}, spec, depth + 1);
      return [item, item, item].slice(0, schema.maxItems ?? 3);
    }
    case "string": {
      if (schema.format === "uuid")      return "11111111-2222-3333-4444-555555555555";
      if (schema.format === "date-time") return "2024-01-01T00:00:00Z";
      if (schema.format === "date")      return "2024-01-01";
      if (schema.format === "email")     return "user@example.com";
      if (schema.format === "uri" || schema.format === "url") return "https://example.com";
      if (schema.format === "ipv4")      return "192.0.2.1";
      if (schema.format === "ipv6")      return "2001:db8::1";
      // Cloudflare uses 32-char hex IDs everywhere.
      if (/^id$|_id$|Id$/.test(name))    return "0123456789abcdef0123456789abcdef";
      if (/name|title/i.test(name))      return "example-" + name.toLowerCase();
      if (/email/i.test(name))           return "user@example.com";
      if (/url|href/i.test(name))        return "https://example.com";
      if (/zone/i.test(name))            return "example.com";
      return "example";
    }
    case "integer":
      if (/page$|count$|total$|size$|index$/i.test(name)) return 1;
      return 42;
    case "number":  return 3.14;
    case "boolean": return true;
    case "null":    return null;
    default: {
      if (schema.properties) return fakeValue(name, { ...schema, type: "object" }, spec, depth + 1);
      if (schema.items)      return fakeValue(name, { ...schema, type: "array" }, spec, depth + 1);
      return null;
    }
  }
}

function pickResponseSchema(op, spec) {
  // Prefer 200 → 201 → 202 → first 2xx → "default".
  const responses = op.responses ?? {};
  const candidates = ["200", "201", "202"]
    .concat(Object.keys(responses).filter((c) => /^2/.test(c) && !["200","201","202"].includes(c)))
    .concat("default");
  for (const code of candidates) {
    const r = responses[code];
    if (!r) continue;
    const resolved = r.$ref ? resolveRef(spec, r.$ref) : r;
    const json = resolved?.content?.["application/json"];
    if (!json) continue;
    if (json.example !== undefined) return { code, value: json.example };
    if (json.examples) {
      const first = Object.values(json.examples)[0];
      if (first && typeof first === "object" && "value" in first) {
        return { code, value: first.value };
      }
    }
    if (json.schema) return { code, schema: json.schema };
  }
  return null;
}

function paramShape(p, spec) {
  const resolved = p.$ref ? resolveRef(spec, p.$ref) : p;
  if (!resolved || typeof resolved !== "object") return null;
  return {
    name:     resolved.name,
    in:       resolved.in,
    type:     resolved.schema?.type ?? "string",
    required: !!resolved.required,
  };
}

// ---- Main ---------------------------------------------------------------

const t0 = Date.now();
console.error("build-globe-data: reading fixture…");
const text = await readFile(FIXTURE, "utf8");
const spec = JSON.parse(text);

const HTTP_VERBS = ["get", "post", "put", "delete", "patch", "options", "head"];
const endpoints = [];
const tagSet = new Set();

for (const [path, item] of Object.entries(spec.paths ?? {})) {
  if (!item || typeof item !== "object") continue;
  // Path-level `parameters` are inherited by every operation.
  const pathParams = (item.parameters ?? []).map((p) => paramShape(p, spec)).filter(Boolean);
  for (const verb of HTTP_VERBS) {
    const op = item[verb];
    if (!op) continue;
    const id = op.operationId ?? `${verb}_${path}`.replace(/[^a-z0-9]+/gi, "_");
    const tag = (op.tags ?? [])[0] ?? "Other";
    tagSet.add(tag);
    const opParams = (op.parameters ?? []).map((p) => paramShape(p, spec)).filter(Boolean);
    const params = [...pathParams, ...opParams];

    let mock = null;
    const resp = pickResponseSchema(op, spec);
    if (resp) {
      if ("value" in resp) {
        mock = resp.value;
      } else if (resp.schema) {
        try {
          mock = fakeValue("response", resp.schema, spec);
        } catch {
          mock = null;
        }
      }
    }
    // Cloudflare's standard envelope when we can't infer anything.
    if (mock == null) {
      mock = { result: null, success: true, errors: [], messages: [] };
    }

    const pop = popFor(`${verb} ${path}`);
    endpoints.push({
      id,
      path,
      method: verb.toUpperCase(),
      tag,
      summary:     op.summary ?? null,
      description: op.description ?? null,
      lat:         pop.lat,
      lng:         pop.lng,
      pop:         pop.city,
      params,
      mock,
    });
  }
}

await mkdir(OUT_DIR, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  stats: {
    paths:      Object.keys(spec.paths ?? {}).length,
    operations: endpoints.length,
    tags:       tagSet.size,
  },
  pops: POPS,
  endpoints,
};
await writeFile(OUT, JSON.stringify(payload));
const dt = ((Date.now() - t0) / 1000).toFixed(1);
const sizeMB = (Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(2);
console.error(`build-globe-data: ${endpoints.length} endpoints, ${tagSet.size} tags, ${sizeMB} MB → ${OUT} in ${dt}s`);
