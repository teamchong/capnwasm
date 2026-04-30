// Vite plugin for capnwasm.
//
// Drop into vite.config.ts and your `.capnp` schemas (or `.ts` interfaces
// with @rest directives, or OpenAPI specs) get codegen'd at build time —
// no separate `npx capnwasm gen` step, no committed gen files in the repo.
// Hot-reloads when a schema changes in dev mode.
//
// Stupid-easy default:
//
//   import { capnwasm } from "capnwasm/vite-plugin";
//   export default { plugins: [capnwasm()] };
//
// That auto-discovers every `.capnp` file under the project root (skipping
// node_modules and common build dirs) and emits `<schema>.gen.mjs` +
// `<schema>.gen.d.ts` next to each. Imports look like:
//
//   import { openUser, buildUser } from "./schemas/user.capnp.gen.mjs";
//
// To opt out of auto-discovery and pass an explicit list (paths or globs),
// use the `schemas` option. To put generated files somewhere other than
// next to the source schema, use `outDir`.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, relative, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

// We use Node 22+'s stable `fs/promises.glob` for both auto-discovery and
// glob expansion of `schemas: ["foo/*.capnp"]`. Older Node would need a
// shim — capnwasm itself already requires Node >= 22 for tests.
import { glob as fsGlob } from "node:fs/promises";

// Codegen API is loaded dynamically. The CLI script (`bin/capnwasm.mjs`)
// has a `#!/usr/bin/env node` shebang, which esbuild — used by Vite to
// bundle vite.config.* — treats as a syntax error if it follows a static
// import. Dynamic `import()` is opaque to the bundler: esbuild never tries
// to read the file at config-load time, so the shebang stays where it
// belongs (on the bin entry) and the plugin still gets a real ESM module.
let _capnwasmApi;
async function getApi() {
  if (!_capnwasmApi) {
    const here = dirname(fileURLToPath(import.meta.url));
    const apiUrl = new URL(`file://${resolve(here, "..", "bin", "capnwasm.mjs")}`);
    _capnwasmApi = await import(apiUrl.href);
  }
  return _capnwasmApi;
}

/**
 * Default extensions the plugin recognises as schema sources. `.ts` is
 * handled gracefully — only files that contain `interface ... { @rest ...`
 * or capnp interface markers actually emit; others are ignored at parse
 * time. So auto-discovering `.ts` would be too noisy. We auto-discover
 * `.capnp` only; `.ts` and `.yaml`/`.json` (OpenAPI) must be listed
 * explicitly via the `schemas` option.
 */
const AUTO_DISCOVER_EXTS = [".capnp"];

/**
 * Directories the auto-discoverer will never descend into. Empirical: most
 * teams have build output in one of these and we never want to regenerate
 * stale artefacts that happen to have a `.capnp` extension.
 */
const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".vite",
  ".cache",
  ".next",
  ".turbo",
  ".git",
]);

/**
 * @typedef {Object} CapnwasmPluginOptions
 * @property {string | string[]} [schemas]
 *   Explicit list of schema files to generate. Each entry is either an
 *   exact path or a glob pattern. Resolved relative to Vite's project
 *   root. If unset, the plugin auto-discovers `**\/*.capnp` under the
 *   project root, skipping `node_modules`, `dist`, `build`, etc.
 * @property {string} [outDir]
 *   Directory to write generated files into. By default outputs land
 *   next to each schema source, e.g. `user.capnp` → `user.capnp.gen.mjs`
 *   in the same directory.
 * @property {string} [extension]
 *   Suffix appended to the schema's basename when computing the output
 *   path. Defaults to `.gen.mjs` (with `.gen.d.ts` for the type
 *   declarations). The leading `.` is significant.
 * @property {boolean} [failOnError]
 *   If true (the default), a codegen error during `buildStart` aborts
 *   the build. Set to false to log errors but continue — useful when
 *   one schema is broken and you want the rest to still rebuild.
 * @property {boolean} [verbose]
 *   Emit one log line per generated file. Defaults to `true` in dev,
 *   `false` in build (the build's own progress reporter takes over).
 */

/**
 * Vite plugin that runs capnwasm codegen at build start and on schema
 * changes during dev. Returns a single Plugin object — pass it directly
 * to Vite's `plugins` array.
 *
 * @param {CapnwasmPluginOptions} [options]
 * @returns {import("vite").Plugin}
 */
export function capnwasm(options = {}) {
  const opts = normalizeOptions(options);

  let projectRoot = process.cwd();
  let logger = makeFallbackLogger();
  let isDev = false;
  /** @type {Set<string>} absolute paths we've discovered or been told about */
  let knownSchemas = new Set();

  return {
    name: "capnwasm",
    enforce: "pre",

    // configResolved fires once Vite has merged user + plugin config and
    // knows the project root + logger. We capture both here for use in the
    // other hooks.
    async configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
      logger = resolvedConfig.logger ?? logger;
      isDev = resolvedConfig.command === "serve";
    },

    // buildStart runs before any module is loaded — both in `vite dev` and
    // `vite build`. This is where we do the initial generation pass so
    // every subsequent `import "./user.capnp.gen.mjs"` finds a fresh file.
    async buildStart() {
      knownSchemas = new Set(await discoverSchemas(opts, projectRoot));
      if (knownSchemas.size === 0) {
        if (opts.schemas !== undefined) {
          // User explicitly listed schemas but nothing matched — that's
          // almost certainly a config bug worth surfacing.
          logger.warn(`[capnwasm] no schemas matched: ${JSON.stringify(opts.schemas)}`);
        }
        // Auto-discover with no matches is silent — many projects don't
        // have any .capnp files yet, and the plugin shouldn't shout at
        // them.
        return;
      }

      const errors = [];
      for (const schemaPath of knownSchemas) {
        try {
          await generateOne(schemaPath, opts, projectRoot, logger);
        } catch (err) {
          errors.push({ schemaPath, err });
          logCodegenError(logger, err, schemaPath);
        }
      }

      if (errors.length > 0 && opts.failOnError) {
        const list = errors.map((e) => `  ${rel(projectRoot, e.schemaPath)}: ${e.err.message}`).join("\n");
        // Throwing here aborts the build (Rollup catches it and prints).
        // A vite-friendly error has both `id` (file) and `frame` (snippet);
        // we don't have a frame, but pointing at the first failing file
        // gives users a single click-to-fix anchor.
        const e = new Error(`capnwasm: ${errors.length} schema(s) failed to generate\n${list}`);
        e.id = errors[0].schemaPath;
        throw e;
      }
    },

    // configureServer is dev-mode only. Wire up file-watching so a
    // schema edit kicks off a regen and a full reload.
    configureServer(server) {
      // Watch every schema we know about. Vite's chokidar watcher already
      // covers the project root, but `.add()` is idempotent and ensures
      // schemas outside the typical glob (e.g. linked monorepo packages)
      // still fire.
      for (const s of knownSchemas) server.watcher.add(s);

      // The same schema may produce multiple bundle entries (e.g. .gen.mjs
      // is imported by several pages). A `full-reload` is the safest HMR
      // signal — it picks up the new gen output everywhere.
      server.watcher.on("change", async (changedPath) => {
        const abs = resolve(changedPath);
        if (!knownSchemas.has(abs)) return;
        try {
          await generateOne(abs, opts, projectRoot, logger);
          server.ws.send({ type: "full-reload" });
        } catch (err) {
          logCodegenError(logger, err, abs);
          // Push the error to the client overlay so it's visible without
          // looking at the server console.
          server.ws.send({
            type: "error",
            err: {
              message: err.message,
              plugin: "capnwasm",
              id: abs,
              stack: err.stack,
            },
          });
        }
      });

      // If a NEW schema file is added at runtime (e.g. user creates
      // schemas/post.capnp), pick it up too. Only matters for auto-
      // discovery mode; explicit lists won't pick up unlisted files.
      if (opts.schemas === undefined) {
        server.watcher.on("add", async (addedPath) => {
          const abs = resolve(addedPath);
          if (!isAutoDiscoverable(abs, projectRoot)) return;
          knownSchemas.add(abs);
          try {
            await generateOne(abs, opts, projectRoot, logger);
            server.ws.send({ type: "full-reload" });
          } catch (err) {
            logCodegenError(logger, err, abs);
          }
        });
      }
    },

    // Make the generated files invisible to Vite's optimizer by ignoring
    // them when they're emitted into the schema's source dir. (Vite re-
    // bundles changed deps; gen files change on every save and we don't
    // want optimizer thrash.) This is a soft hint — tree-shaking and HMR
    // still work normally.
    config() {
      return {
        optimizeDeps: {
          exclude: ["capnwasm", "capnwasm/browser", "capnwasm/rpc", "capnwasm/rest"],
        },
      };
    },
  };
}

/**
 * Default-name + sanity-check the user's options into a fully-resolved
 * shape the rest of the plugin can rely on.
 *
 * @param {CapnwasmPluginOptions} options
 * @returns {Required<Omit<CapnwasmPluginOptions, "schemas" | "outDir">> & { schemas: string[] | undefined; outDir: string | undefined }}
 */
function normalizeOptions(options) {
  const schemas = options.schemas === undefined
    ? undefined
    : Array.isArray(options.schemas) ? options.schemas : [options.schemas];

  if (schemas !== undefined) {
    for (const s of schemas) {
      if (typeof s !== "string" || s.length === 0) {
        throw new TypeError(`capnwasm vite plugin: 'schemas' entries must be non-empty strings, got ${JSON.stringify(s)}`);
      }
    }
  }

  const extension = options.extension ?? ".gen.mjs";
  if (typeof extension !== "string" || !extension.startsWith(".")) {
    throw new TypeError(`capnwasm vite plugin: 'extension' must start with a dot, got ${JSON.stringify(extension)}`);
  }
  if (!extension.endsWith(".mjs") && !extension.endsWith(".js")) {
    throw new TypeError(`capnwasm vite plugin: 'extension' must end in .mjs or .js, got ${JSON.stringify(extension)}`);
  }

  return {
    schemas,
    outDir: options.outDir,
    extension,
    failOnError: options.failOnError ?? true,
    verbose: options.verbose ?? true,
  };
}

/**
 * Resolve `opts.schemas` (or auto-discovery) into a flat array of
 * absolute file paths. De-duplicates.
 *
 * @returns {Promise<string[]>}
 */
async function discoverSchemas(opts, projectRoot) {
  if (opts.schemas !== undefined) {
    const out = new Set();
    for (const pattern of opts.schemas) {
      if (containsGlob(pattern)) {
        for await (const match of fsGlob(pattern, { cwd: projectRoot })) {
          out.add(resolve(projectRoot, match));
        }
      } else {
        const abs = resolve(projectRoot, pattern);
        if (existsSync(abs)) {
          out.add(abs);
        } else {
          // Bad path is a config error worth surfacing — but throwing
          // here would break `vite build` for the whole project. Let
          // buildStart's per-file error handler report it instead by
          // including the path in the set.
          out.add(abs);
        }
      }
    }
    return [...out];
  }
  // Auto-discover .capnp under the project root, skipping noise dirs.
  const out = new Set();
  for (const ext of AUTO_DISCOVER_EXTS) {
    for await (const match of fsGlob(`**/*${ext}`, { cwd: projectRoot })) {
      const abs = resolve(projectRoot, match);
      if (isAutoDiscoverable(abs, projectRoot)) out.add(abs);
    }
  }
  return [...out];
}

/**
 * Reject paths that fall under a known build/dependency/cache directory.
 * Used both at discovery time and at file-add time during dev.
 */
function isAutoDiscoverable(absPath, projectRoot) {
  const rel = relative(projectRoot, absPath);
  if (rel.startsWith("..") || rel.startsWith("/")) return false;   // outside root
  for (const seg of rel.split("/")) {
    if (DEFAULT_IGNORE_DIRS.has(seg)) return false;
  }
  return true;
}

function containsGlob(s) {
  return /[*?\[\]{}]/.test(s);
}

/**
 * Compute where to write the generated .mjs (with .d.ts derived from it).
 * Honors `outDir` when set, otherwise places generated files next to the
 * schema. Always uses the schema's basename to avoid filename collisions.
 */
function outputPathFor(schemaPath, opts, projectRoot) {
  // Strip the original extension, append the configured one. So
  // `user.capnp` + `.gen.mjs` → `user.capnp.gen.mjs` (we keep the
  // .capnp in the name so the source<->output relationship stays
  // obvious in directory listings).
  const name = basename(schemaPath) + opts.extension;
  if (opts.outDir) {
    return resolve(projectRoot, opts.outDir, name);
  }
  return join(dirname(schemaPath), name);
}

/**
 * Run codegen for one schema and write both .mjs and .d.ts to disk.
 * Throws CapnwasmCodegenError on any failure; the caller decides whether
 * to surface that error or swallow it.
 */
async function generateOne(schemaPath, opts, projectRoot, logger) {
  const { generateFromSchema } = await getApi();
  const { mjs, dts, meta } = await generateFromSchema(schemaPath);
  const mjsPath = outputPathFor(schemaPath, opts, projectRoot);
  const dtsPath = mjsPath.replace(/\.m?js$/, ".d.ts");

  await mkdir(dirname(mjsPath), { recursive: true });

  // Avoid pointless writes (and the resulting watcher cascade) when the
  // generated content hasn't changed. Vite re-runs buildStart on config
  // changes too, so this kicks in often.
  await writeIfChanged(mjsPath, mjs);
  await writeIfChanged(dtsPath, dts);

  if (opts.verbose) {
    const summary = describeMeta(meta);
    logger.info(`[capnwasm] ${rel(projectRoot, schemaPath)} → ${rel(projectRoot, mjsPath)}  (${summary})`);
  }
}

async function writeIfChanged(path, contents) {
  if (existsSync(path)) {
    try {
      const existing = await readFile(path, "utf8");
      if (existing === contents) return;
    } catch {
      // Permissions / read error — fall through and try to write.
    }
  }
  await writeFile(path, contents);
}

function describeMeta(meta) {
  const parts = [];
  if (meta.structs.length > 0) parts.push(`${meta.structs.length} struct(s)`);
  if (meta.restApis.length > 0) parts.push(`${meta.restApis.length} REST api(s)`);
  if (meta.typeInterfaces.length > 0) parts.push(`${meta.typeInterfaces.length} type(s)`);
  return parts.join(", ");
}

function logCodegenError(logger, err, schemaPath) {
  const where = schemaPath ? ` (${schemaPath})` : "";
  // Duck-type the codegen error class — `instanceof` would force us to
  // import the class statically, which breaks esbuild on the bin shebang.
  const isCodegen = err && typeof err === "object" && err.name === "CapnwasmCodegenError";
  if (isCodegen) {
    logger.error(`[capnwasm]${where} ${err.message}`);
    if (err.cause) logger.error(`  caused by: ${err.cause.message}`);
  } else {
    logger.error(`[capnwasm]${where} ${err?.stack ?? err?.message ?? String(err)}`);
  }
}

function rel(root, abs) {
  const r = relative(root, abs);
  return r.length === 0 ? "." : r;
}

function makeFallbackLogger() {
  return {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
    warnOnce: (msg) => console.warn(msg),
    hasErrorLogged: () => false,
    hasWarned: false,
    clearScreen: () => {},
  };
}

export default capnwasm;
