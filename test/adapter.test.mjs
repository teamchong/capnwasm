// Pagination + error-envelope adapter.
//
// Pins the detector contract: each well-known pagination shape and
// error envelope shape gets a dedicated fixture, plus an immutability
// test (the adapter never mutates its input manifest).

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { adapt, summarize } from "../js/adapter.mjs";

function manifestFromSpec(spec) {
  return buildManifest(parseOpenApi(spec), { source: { name: "spec.json", format: "openapi" } });
}

// --- Pagination -------------------------------------------------------

test("adapt: cursor pattern", () => {
  const spec = makePagedSpec({
    paramNames: ["cursor", "limit"],
    response: { items: { type: "array", items: { type: "string" } }, next_cursor: { type: "string" } },
  });
  const out = adapt(manifestFromSpec(spec));
  const pag = out.restApis[0].methods[0].pagination;
  assert.equal(pag.kind, "cursor");
  assert.equal(pag.params.cursor, "cursor");
  assert.equal(pag.params.size, "limit");
  assert.equal(pag.response.nextField, "next_cursor");
});

test("adapt: cursor pattern via 'after' param + 'next' field", () => {
  const spec = makePagedSpec({
    paramNames: ["after", "per_page"],
    response: { items: { type: "array", items: { type: "string" } }, next: { type: "string" } },
  });
  const out = adapt(manifestFromSpec(spec));
  const pag = out.restApis[0].methods[0].pagination;
  assert.equal(pag.kind, "cursor");
  assert.equal(pag.params.cursor, "after");
  assert.equal(pag.params.size, "per_page");
  assert.equal(pag.response.nextField, "next");
});

test("adapt: offset pattern", () => {
  const spec = makePagedSpec({
    paramNames: ["offset", "limit"],
    response: { items: { type: "array", items: { type: "string" } } },
  });
  const out = adapt(manifestFromSpec(spec));
  const pag = out.restApis[0].methods[0].pagination;
  assert.equal(pag.kind, "offset");
  assert.equal(pag.params.size, "limit");
});

test("adapt: page pattern", () => {
  const spec = makePagedSpec({
    paramNames: ["page", "page_size"],
    response: { items: { type: "array", items: { type: "string" } } },
  });
  const out = adapt(manifestFromSpec(spec));
  const pag = out.restApis[0].methods[0].pagination;
  assert.equal(pag.kind, "page");
  assert.equal(pag.params.size, "page_size");
});

test("adapt: page-token pattern", () => {
  const spec = makePagedSpec({
    paramNames: ["page_token"],
    response: { items: { type: "array", items: { type: "string" } }, next_page_token: { type: "string" } },
  });
  const out = adapt(manifestFromSpec(spec));
  const pag = out.restApis[0].methods[0].pagination;
  assert.equal(pag.kind, "page-token");
  assert.equal(pag.params.token, "page_token");
  assert.equal(pag.response.nextField, "next_page_token");
});

test("adapt: unknown when no pagination params present", () => {
  const spec = makeBasicSpec({ paramNames: ["filter"] });
  const out = adapt(manifestFromSpec(spec));
  assert.equal(out.restApis[0].methods[0].pagination.kind, "unknown");
});

test("adapt: page-token wins over plain cursor when both present (most specific)", () => {
  const spec = makePagedSpec({
    paramNames: ["cursor", "page_token", "limit"],
    response: { items: { type: "array", items: { type: "string" } } },
  });
  const out = adapt(manifestFromSpec(spec));
  assert.equal(out.restApis[0].methods[0].pagination.kind, "page-token");
});

// --- Error envelopes --------------------------------------------------

test("adapt: detects RFC 7807 envelope", () => {
  const spec = makeErrorSpec({
    type: "object",
    properties: {
      type: { type: "string" }, title: { type: "string" }, detail: { type: "string" }, status: { type: "integer" },
    },
  });
  const out = adapt(manifestFromSpec(spec));
  const shapes = out.restApis[0].methods[0].errorShapes;
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].shape, "rfc7807");
});

test("adapt: detects single error envelope", () => {
  const spec = makeErrorSpec({
    type: "object",
    properties: {
      error: { type: "object", properties: { code: { type: "integer" }, message: { type: "string" } } },
    },
  });
  const out = adapt(manifestFromSpec(spec));
  const shapes = out.restApis[0].methods[0].errorShapes;
  assert.equal(shapes[0].shape, "single");
});

test("adapt: detects list error envelope", () => {
  const spec = makeErrorSpec({
    type: "object",
    properties: {
      errors: { type: "array", items: { type: "object", properties: { code: { type: "integer" }, message: { type: "string" } } } },
    },
  });
  const out = adapt(manifestFromSpec(spec));
  const shapes = out.restApis[0].methods[0].errorShapes;
  assert.equal(shapes[0].shape, "list");
});

test("adapt: unrecognized envelope falls back to passthrough", () => {
  const spec = makeErrorSpec({
    type: "object",
    properties: { code: { type: "integer" }, message: { type: "string" } },
  });
  const out = adapt(manifestFromSpec(spec));
  const shapes = out.restApis[0].methods[0].errorShapes;
  assert.equal(shapes[0].shape, "passthrough");
});

test("adapt: walks allOf when classifying an error envelope", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/x": {
        get: {
          operationId: "getX",
          responses: {
            200: { description: "ok" },
            400: {
              description: "err",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Wrap" }, { type: "object", properties: { detail: { type: "string" } } }] } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Wrap: { type: "object", properties: { type: { type: "string" }, title: { type: "string" } } },
      },
    },
  };
  const out = adapt(manifestFromSpec(spec));
  const shapes = out.restApis[0].methods[0].errorShapes;
  assert.equal(shapes[0].shape, "rfc7807");
});

// --- Immutability + summarize ----------------------------------------

test("adapt: does not mutate the input manifest", () => {
  const spec = makePagedSpec({
    paramNames: ["cursor", "limit"],
    response: { items: { type: "array", items: { type: "string" } }, next_cursor: { type: "string" } },
  });
  const m = manifestFromSpec(spec);
  const before = JSON.stringify(m);
  adapt(m);
  const after = JSON.stringify(m);
  assert.equal(before, after);
});

test("summarize: counts pagination + error shapes", () => {
  // Two operations: one cursor + list errors, one offset + single error.
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/a": {
        get: {
          operationId: "listA",
          parameters: [
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit",  in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { next_cursor: { type: "string" } } } } } },
            400: { description: "err", content: { "application/json": { schema: { type: "object", properties: { errors: { type: "array", items: { type: "object" } } } } } } },
          },
        },
      },
      "/b": {
        get: {
          operationId: "listB",
          parameters: [
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "limit",  in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: { description: "ok" },
            500: { description: "err", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "integer" } } } } } } } },
          },
        },
      },
    },
  };
  const out = adapt(manifestFromSpec(spec));
  const s = summarize(out);
  assert.equal(s.total, 2);
  assert.equal(s.pagination.cursor, 1);
  assert.equal(s.pagination.offset, 1);
  assert.equal(s.errors.list, 1);
  assert.equal(s.errors.single, 1);
});

// --- Helpers -----------------------------------------------------------

function makeBasicSpec({ paramNames }) {
  return {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          parameters: paramNames.map((n) => ({ name: n, in: "query", schema: { type: "string" } })),
          responses: { 200: { description: "ok" } },
        },
      },
    },
  };
}

function makePagedSpec({ paramNames, response }) {
  return {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          parameters: paramNames.map((n) => ({ name: n, in: "query", schema: { type: "string" } })),
          responses: {
            200: {
              description: "ok",
              content: { "application/json": { schema: { type: "object", properties: response } } },
            },
          },
        },
      },
    },
  };
}

function makeErrorSpec(errorBodySchema) {
  return {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/items/{id}": {
        get: {
          operationId: "getItem",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "ok" },
            404: { description: "err", content: { "application/json": { schema: errorBodySchema } } },
          },
        },
      },
    },
  };
}
