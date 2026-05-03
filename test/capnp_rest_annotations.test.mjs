// $Rest.* annotation reader: capnp source → manifest → OpenAPI.
//
// The complement of the OpenAPI → capnp direction: when a .capnp file
// uses the $Rest.path()/$Rest.method() annotation namespace, the
// manifest gets a restApis entry alongside the interfaces entry, and
// emit-openapi produces a meaningful OpenAPI doc instead of an empty
// shell.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const SOURCE = `@0xb1234abc12345001;

interface Petstore {
  getPet @0 (id :Text) -> (pet :Text)
    $Rest.path("/v1/pets/{id}")
    $Rest.method("GET");

  listPets @1 (limit :Int32) -> (pets :Text)
    $Rest.path("/v1/pets")
    $Rest.method("GET");

  createPet @2 (name :Text) -> (pet :Text)
    $Rest.path("/v1/pets")
    $Rest.method("POST");
}
`;

function runManifest(source) {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-rest-anno-"));
  const capnpPath = join(dir, "demo.capnp");
  writeFileSync(capnpPath, source);
  const manifestPath = join(dir, "demo.manifest.json");
  const r = spawnSync("node", [CLI, "manifest", capnpPath, "-o", manifestPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`manifest failed: ${r.stderr}`);
  return { dir, manifestPath, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) };
}

test("manifest from .capnp with $Rest annotations: emits both interfaces[] and restApis[]", () => {
  const { manifest } = runManifest(SOURCE);
  // capnp interface side stays as before (kept for native capnp consumers).
  assert.equal(manifest.interfaces.length, 1);
  assert.equal(manifest.interfaces[0].name, "Petstore");
  assert.equal(manifest.interfaces[0].methods.length, 3);
  // restApis side surfaces the HTTP semantics from the annotations.
  assert.equal(manifest.restApis.length, 1);
  const api = manifest.restApis[0];
  assert.equal(api.name, "Petstore");
  assert.equal(api.methods.length, 3);
  const byOp = Object.fromEntries(api.methods.map((m) => [m.name, m]));
  assert.equal(byOp.getPet.httpMethod, "GET");
  assert.equal(byOp.getPet.path, "/v1/pets/{id}");
  assert.equal(byOp.listPets.httpMethod, "GET");
  assert.equal(byOp.listPets.path, "/v1/pets");
  assert.equal(byOp.createPet.httpMethod, "POST");
});

test("manifest from .capnp without $Rest annotations: restApis stays empty", () => {
  const bareSource = `@0xb1234abc12345002;

interface Plain {
  ping @0 () -> ();
}
`;
  const { manifest } = runManifest(bareSource);
  assert.equal(manifest.interfaces.length, 1);
  assert.equal(manifest.restApis.length, 0);
});

test("emit-openapi from a $Rest-annotated .capnp produces real paths", () => {
  const { dir, manifestPath } = runManifest(SOURCE);
  const openapiPath = join(dir, "demo.openapi.json");
  const r = spawnSync("node", [CLI, "emit-openapi", manifestPath, "-o", openapiPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(readFileSync(openapiPath, "utf8"));
  assert.equal(doc.openapi, "3.0.3");
  // Both annotated paths appear; the path with parameters preserves
  // the OpenAPI {id} templating syntax.
  assert.ok(doc.paths["/v1/pets"]);
  assert.ok(doc.paths["/v1/pets"].get);
  assert.ok(doc.paths["/v1/pets"].post);
  assert.ok(doc.paths["/v1/pets/{id}"]);
  assert.ok(doc.paths["/v1/pets/{id}"].get);
});

test("emit-openapi: GET method with path + query params materializes both", () => {
  const richSource = `@0xb1234abc12345005;

interface Demo {
  getItem @0 (id :Text, expand :Text) -> (item :Text, found :Bool)
    $Rest.path("/items/{id}")
    $Rest.method("GET");
}
`;
  const { dir, manifestPath } = runManifest(richSource);
  const openapiPath = join(dir, "demo.openapi.json");
  spawnSync("node", [CLI, "emit-openapi", manifestPath, "-o", openapiPath], { encoding: "utf8" });
  const doc = JSON.parse(readFileSync(openapiPath, "utf8"));
  const op = doc.paths["/items/{id}"].get;
  // Path param "id" + query param "expand" both surface.
  const byIn = Object.fromEntries(op.parameters.map((p) => [p.name, p]));
  assert.equal(byIn.id.in, "path");
  assert.equal(byIn.id.required, true);
  assert.equal(byIn.id.schema.type, "string");
  assert.equal(byIn.expand.in, "query");
  assert.equal(byIn.expand.required, false);
  assert.equal(byIn.expand.schema.type, "string");
  // Response references a sanitized component schema (no `$`).
  assert.equal(op.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/GetItemResults");
  assert.ok(doc.components.schemas.GetItemResults);
  assert.equal(doc.components.schemas.GetItemResults.properties.item.type, "string");
  assert.equal(doc.components.schemas.GetItemResults.properties.found.type, "boolean");
});

test("emit-openapi: POST bundles non-path params into a JSON body", () => {
  const postSource = `@0xb1234abc12345006;

interface Demo {
  createItem @0 (kind :Text, weight :Float32) -> (id :Text)
    $Rest.path("/items")
    $Rest.method("POST");
}
`;
  const { dir, manifestPath } = runManifest(postSource);
  const openapiPath = join(dir, "demo.openapi.json");
  spawnSync("node", [CLI, "emit-openapi", manifestPath, "-o", openapiPath], { encoding: "utf8" });
  const doc = JSON.parse(readFileSync(openapiPath, "utf8"));
  const post = doc.paths["/items"].post;
  // Body fields are NOT in parameters; they're in requestBody.
  assert.ok(!post.parameters);
  assert.ok(post.requestBody);
  const body = post.requestBody.content["application/json"].schema;
  assert.equal(body.type, "object");
  assert.equal(body.properties.kind.type, "string");
  assert.equal(body.properties.weight.type, "number");
  assert.equal(body.properties.weight.format, "float");
});

test("emit-openapi: List(X) capnp results round-trip to OpenAPI array schemas", () => {
  const listSource = `@0xb1234abc12345007;

interface Demo {
  listItems @0 () -> (items :List(Text), nextCursor :Text)
    $Rest.path("/items")
    $Rest.method("GET");
}
`;
  const { dir, manifestPath } = runManifest(listSource);
  const openapiPath = join(dir, "demo.openapi.json");
  spawnSync("node", [CLI, "emit-openapi", manifestPath, "-o", openapiPath], { encoding: "utf8" });
  const doc = JSON.parse(readFileSync(openapiPath, "utf8"));
  const schema = doc.components.schemas.ListItemsResults;
  assert.equal(schema.properties.items.type, "array");
  assert.equal(schema.properties.items.items.type, "string");
  assert.equal(schema.properties.nextCursor.type, "string");
});

test("$Rest annotation reader: ignores commented-out annotations", () => {
  const sourceWithComment = `@0xb1234abc12345003;

interface Demo {
  # getPet @0 (id :Text) -> (pet :Text)
  #   $Rest.path("/commented") $Rest.method("GET");

  realOp @0 (x :Text) -> (y :Text)
    $Rest.path("/real")
    $Rest.method("POST");
}
`;
  const { manifest } = runManifest(sourceWithComment);
  assert.equal(manifest.restApis.length, 1);
  assert.equal(manifest.restApis[0].methods.length, 1);
  assert.equal(manifest.restApis[0].methods[0].path, "/real");
});
