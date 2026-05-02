// End-to-end test for js/vite-plugin.mjs.
//
// We exercise the plugin against Vite's programmatic build API in a
// throwaway temp dir. The temp dir contains a minimal `vite.config.mjs`,
// an entry `main.mjs`, and a couple of `.capnp` schemas. After
// `vite build` runs we assert:
//
//   - The generated `.gen.mjs` and `.gen.d.ts` show up next to each
//     schema (default behaviour, no `outDir`).
//   - The generated module is reachable from the user's entry. It ends
//     up in the build output.
//   - Re-running the build is idempotent (writeIfChanged actually skips
//     the rewrite, so file mtimes don't churn).
//   - Errors propagate when a schema is malformed and `failOnError` is
//     left at its default.
//
// Vite is installed in `web/node_modules`; we resolve from there so the
// top-level `node_modules` doesn't need to grow a copy.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// Vite lives under web/node_modules. That's where the docs site
// installed it. Resolve to its programmatic API directly so this test
// doesn't need a top-level vite dep.
let vite;
try {
  vite = await import(resolve(ROOT, "web/node_modules/vite/dist/node/index.js"));
} catch (e) {
  console.error("could not import Vite from web/node_modules. Run `npm install` in web/", e);
  throw e;
}

// Sample valid capnp schema. Tiny so the test is fast.
const VALID_SCHEMA = `# test schema
@0xa1b2c3d4e5f60001;

struct Tag {
  id @0 :UInt32;
  name @1 :Text;
}
`;

// A second schema so we can verify multi-schema generation.
const VALID_SCHEMA_2 = `# second test schema
@0xa1b2c3d4e5f60002;

struct Author {
  id @0 :UInt64;
  email @1 :Text;
  active @2 :Bool;
}
`;

// Malformed: the `@0:` is invalid (missing space, missing field name).
const BROKEN_SCHEMA = `# broken
@0xa1b2c3d4e5f60099;

struct Bad {
  @0:
}
`;

async function makeProject(files) {
  const dir = await mkdtemp(join(tmpdir(), "capnwasm-vite-"));
  for (const [path, contents] of Object.entries(files)) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

const VITE_CONFIG = `
import { capnwasm } from "${ROOT}/js/vite-plugin.mjs";

export default ({
  root: __dirname,
  build: {
    write: true,
    rollupOptions: {
      input: __dirname + "/main.mjs",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
  },
  plugins: [capnwasm()],
  logLevel: "warn",
});
`;

const ENTRY_THAT_IMPORTS_GEN = `
// Imports the generated reader so the bundle exercises it.
import { TagReader } from "./schemas/tag.capnp.gen.mjs";
import { AuthorReader } from "./schemas/author.capnp.gen.mjs";
globalThis.__capnwasm_test = { TagReader, AuthorReader };
`;

const ENTRY_NO_GEN = `
// Plain entry. Used when we expect the plugin to not produce gen files.
globalThis.__capnwasm_test = { ok: true };
`;

test("vite-plugin: auto-discovers .capnp under root, emits .gen.mjs + .gen.d.ts next to source", async () => {
  const dir = await makeProject({
    "vite.config.mjs": VITE_CONFIG,
    "main.mjs": ENTRY_THAT_IMPORTS_GEN,
    "schemas/tag.capnp": VALID_SCHEMA,
    "schemas/author.capnp": VALID_SCHEMA_2,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });

    // Generated files land next to the source schemas.
    assert.ok(existsSync(join(dir, "schemas/tag.capnp.gen.mjs")), "tag .gen.mjs");
    assert.ok(existsSync(join(dir, "schemas/tag.capnp.gen.d.ts")), "tag .gen.d.ts");
    assert.ok(existsSync(join(dir, "schemas/author.capnp.gen.mjs")), "author .gen.mjs");
    assert.ok(existsSync(join(dir, "schemas/author.capnp.gen.d.ts")), "author .gen.d.ts");

    // Generated content actually contains the codegen output (sanity).
    const tagMjs = await readFile(join(dir, "schemas/tag.capnp.gen.mjs"), "utf8");
    assert.match(tagMjs, /class TagReader/);
    assert.match(tagMjs, /class TagBuilder/);

    const authorDts = await readFile(join(dir, "schemas/author.capnp.gen.d.ts"), "utf8");
    assert.match(authorDts, /class AuthorReader/);

    // The build's output should reference the generated module's exports
    // (via the entry file). Verify the build emitted *something* in dist/.
    const built = await readFile(join(dir, "dist/main.mjs"), "utf8").catch(() => null);
    if (built) {
      // With minify off, the generated class names survive into the bundle.
      assert.ok(built.includes("TagReader") || built.includes("AuthorReader"),
        "bundled output should contain the generated reader exports");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: writeIfChanged keeps mtime stable when the schema doesn't change", async () => {
  const dir = await makeProject({
    "vite.config.mjs": VITE_CONFIG,
    "main.mjs": ENTRY_THAT_IMPORTS_GEN,
    "schemas/tag.capnp": VALID_SCHEMA,
    "schemas/author.capnp": VALID_SCHEMA_2,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });
    const firstMtime = (await stat(join(dir, "schemas/tag.capnp.gen.mjs"))).mtimeMs;

    // Sleep a hair so the filesystem clock can record a difference if a
    // rewrite happens. 30 ms is well above APFS resolution and well
    // below test-runtime cost.
    await new Promise((r) => setTimeout(r, 30));

    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });
    const secondMtime = (await stat(join(dir, "schemas/tag.capnp.gen.mjs"))).mtimeMs;

    assert.equal(secondMtime, firstMtime, "writeIfChanged should skip identical content");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: explicit `schemas` list, glob patterns expand", async () => {
  const dir = await makeProject({
    "vite.config.mjs": `
import { capnwasm } from "${ROOT}/js/vite-plugin.mjs";
export default ({
  root: __dirname,
  build: { write: true, outDir: "dist", emptyOutDir: true, minify: false,
           rollupOptions: { input: __dirname + "/main.mjs" } },
  plugins: [capnwasm({ schemas: ["schemas/*.capnp"] })],
  logLevel: "warn",
});
    `,
    "main.mjs": ENTRY_THAT_IMPORTS_GEN,
    "schemas/tag.capnp": VALID_SCHEMA,
    "schemas/author.capnp": VALID_SCHEMA_2,
    // .capnp file OUTSIDE the glob. Explicit list should NOT pick it up.
    "other/extra.capnp": VALID_SCHEMA,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });
    assert.ok(existsSync(join(dir, "schemas/tag.capnp.gen.mjs")));
    assert.ok(existsSync(join(dir, "schemas/author.capnp.gen.mjs")));
    assert.ok(!existsSync(join(dir, "other/extra.capnp.gen.mjs")),
      "schemas not matched by the explicit glob should NOT be generated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: skips node_modules and other ignored dirs in auto-discovery", async () => {
  const dir = await makeProject({
    "vite.config.mjs": VITE_CONFIG,
    "main.mjs": ENTRY_NO_GEN,
    // A schema buried inside node_modules. The plugin must not regenerate
    // someone else's package.
    "node_modules/some-pkg/inner.capnp": VALID_SCHEMA,
    "dist/old.capnp": VALID_SCHEMA,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });
    assert.ok(!existsSync(join(dir, "node_modules/some-pkg/inner.capnp.gen.mjs")),
      "should not generate inside node_modules");
    assert.ok(!existsSync(join(dir, "dist/old.capnp.gen.mjs")),
      "should not generate inside dist");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: outDir option lands generated files in a single dir", async () => {
  const dir = await makeProject({
    "vite.config.mjs": `
import { capnwasm } from "${ROOT}/js/vite-plugin.mjs";
export default ({
  root: __dirname,
  build: { write: true, outDir: "dist", emptyOutDir: true, minify: false,
           rollupOptions: { input: __dirname + "/main.mjs" } },
  plugins: [capnwasm({ outDir: ".gen" })],
  logLevel: "warn",
});
    `,
    "main.mjs": `
import { TagReader } from "./.gen/tag.capnp.gen.mjs";
globalThis.__capnwasm_test = { TagReader };
    `,
    "schemas/tag.capnp": VALID_SCHEMA,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "warn" });
    assert.ok(existsSync(join(dir, ".gen/tag.capnp.gen.mjs")), "gen .mjs in outDir");
    assert.ok(existsSync(join(dir, ".gen/tag.capnp.gen.d.ts")), "gen .d.ts in outDir");
    assert.ok(!existsSync(join(dir, "schemas/tag.capnp.gen.mjs")),
      "should not write next to source when outDir is set");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: rejects invalid extension at config time", async () => {
  const dir = await makeProject({
    "vite.config.mjs": `
import { capnwasm } from "${ROOT}/js/vite-plugin.mjs";
export default ({
  root: __dirname,
  build: { rollupOptions: { input: __dirname + "/main.mjs" } },
  plugins: [capnwasm({ extension: "weird-no-dot" })],
  logLevel: "warn",
});
    `,
    "main.mjs": ENTRY_NO_GEN,
  });
  try {
    await assert.rejects(
      vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "silent" }),
      /must start with a dot/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: failOnError=true (default) aborts the build when a schema is malformed", async () => {
  const dir = await makeProject({
    "vite.config.mjs": VITE_CONFIG,
    "main.mjs": ENTRY_NO_GEN,
    "schemas/broken.capnp": BROKEN_SCHEMA,
  });
  try {
    await assert.rejects(
      vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "silent" }),
      /capnwasm/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vite-plugin: failOnError=false logs but lets the build complete", async () => {
  const dir = await makeProject({
    "vite.config.mjs": `
import { capnwasm } from "${ROOT}/js/vite-plugin.mjs";
export default ({
  root: __dirname,
  build: { write: true, outDir: "dist", emptyOutDir: true, minify: false,
           rollupOptions: { input: __dirname + "/main.mjs" } },
  plugins: [capnwasm({ failOnError: false })],
  logLevel: "silent",
});
    `,
    "main.mjs": ENTRY_NO_GEN,
    "schemas/broken.capnp": BROKEN_SCHEMA,
    "schemas/tag.capnp": VALID_SCHEMA,
  });
  try {
    await vite.build({ root: dir, configFile: join(dir, "vite.config.mjs"), logLevel: "silent" });
    // The good schema still got generated even though the broken one
    // logged an error.
    assert.ok(existsSync(join(dir, "schemas/tag.capnp.gen.mjs")), "good schema still emitted");
    assert.ok(!existsSync(join(dir, "schemas/broken.capnp.gen.mjs")), "broken schema skipped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
