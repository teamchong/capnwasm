// Unified pipeline runner.
//
// Reads a capnwasm.config.json (or accepts inline opts) and runs the
// full schema-truth chain in one pass:
//
//   manifest → adapt → lock → emit-capnp → emit-openapi → emit-agents
//
// Each step writes to a configured outputDir (default: alongside the
// source). Steps can be individually disabled via opts.steps.
//
// Config file shape (`capnwasm.config.json`):
//
//   {
//     "input":     "./schema.capnp"  | "./openapi.json",
//     "outputDir": "./capnwasm-out",
//     "lockIn":    "./capnwasm.lock",
//     "steps": {
//       "manifest":          true,
//       "adapt":             true,
//       "lock":              true,
//       "lockDetectRenames": true,
//       "emitCapnp":         true,
//       "emitOpenapi":       true,
//       "emitAgents":        true,
//       "emitCodec":         false
//     }
//   }
//
// CLI flags (npx capnwasm pipeline ...) override the corresponding
// config keys; missing keys take their defaults.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename, extname, join } from "node:path";

const DEFAULT_STEPS = {
  manifest: true,
  adapt: true,
  lock: true,
  lockDetectRenames: true,
  emitCapnp: true,
  emitOpenapi: true,
  emitAgents: true,
  emitCodec: false,    // off by default since it requires capnp compilation
};

/**
 * Run the pipeline. Returns a structured report listing every artifact
 * written and the per-step summary numbers.
 *
 * @param {object} opts
 * @param {string} opts.input - .capnp / .ts / OpenAPI source path
 * @param {string} [opts.outputDir]
 * @param {string} [opts.lockIn] - existing lock to update (otherwise bootstrap)
 * @param {object} [opts.steps]
 * @param {(line: string) => void} [opts.log] - per-step progress logger
 * @param {Function} [opts.parseSchema] - injected parser for capnp/.ts
 *        sources (defaults to dynamic import of bin/capnwasm.mjs which
 *        owns the capnp + TS @rest parsers).
 */
export async function runPipeline(opts) {
  if (!opts?.input) throw new Error("pipeline: input is required");
  if (!existsSync(opts.input)) throw new Error(`pipeline: input not found: ${opts.input}`);

  const steps = { ...DEFAULT_STEPS, ...(opts.steps ?? {}) };
  const outDir = opts.outputDir ?? dirname(resolve(opts.input));
  await mkdir(outDir, { recursive: true });

  const log = opts.log ?? ((line) => process.stderr.write(line + "\n"));
  const stem = basename(opts.input, extname(opts.input));
  const report = { artifacts: [], steps: {}, outputDir: outDir };
  const writeOut = async (relName, content) => {
    const p = join(outDir, relName);
    await writeFile(p, content);
    report.artifacts.push(p);
    log(`  wrote ${p}`);
    return p;
  };

  // 1. Build the model + manifest -----------------------------------
  const ext = extname(opts.input).toLowerCase();
  const isOpenapi = ext === ".yaml" || ext === ".yml" || ext === ".json";

  let model, format;
  if (isOpenapi) {
    const text = await readFile(opts.input, "utf8");
    let spec;
    if (ext === ".json") {
      spec = JSON.parse(text);
    } else {
      const yaml = await import("yaml");
      spec = yaml.parse(text);
    }
    const { parseOpenApi } = await import("./openapi_parser.mjs");
    model = parseOpenApi(spec);
    format = "openapi";
  } else {
    // .capnp or .ts source: caller-injected parser, or dynamic import
    // of bin/capnwasm.mjs which owns those parsers.
    const parseSchema = opts.parseSchema ?? (await import("../bin/capnwasm.mjs")).parseSchema;
    if (typeof parseSchema !== "function") {
      throw new Error("pipeline: no parser available for non-OpenAPI sources (provide opts.parseSchema)");
    }
    model = await parseSchema(opts.input);
    format = opts.input.endsWith(".ts") || opts.input.endsWith(".tsx")
      ? "typescript-rest"
      : "capnp";
  }

  const { buildManifest, buildManifestJson } = await import("./manifest.mjs");
  const manifest = buildManifest(model, {
    source: { name: basename(opts.input), format, path: resolve(opts.input) },
  });

  if (steps.manifest) {
    const json = buildManifestJson(model, {
      source: { name: basename(opts.input), format, path: resolve(opts.input) },
    });
    await writeOut(`${stem}.manifest.json`, json);
    report.steps.manifest = { operations: countOperations(manifest) };
  }

  // 2. Adapt --------------------------------------------------------
  let adapted = manifest;
  if (steps.adapt) {
    const { adapt, summarize } = await import("./adapter.mjs");
    adapted = adapt(manifest);
    await writeOut(`${stem}.adapted.json`, JSON.stringify(adapted, null, 2) + "\n");
    report.steps.adapt = summarize(adapted);
  }

  // 3. Lock ---------------------------------------------------------
  if (steps.lock) {
    const { buildCapnp } = await import("./emit_capnp.mjs");
    const { structures } = buildCapnp(manifest);
    const { updateLock, lockToJson } = await import("./lock.mjs");
    let prev = null;
    if (opts.lockIn) {
      if (!existsSync(opts.lockIn)) throw new Error(`pipeline: lockIn not found: ${opts.lockIn}`);
      prev = JSON.parse(await readFile(opts.lockIn, "utf8"));
    }
    const { lock, diff } = updateLock(prev, structures, {
      manifestSource: manifest.source?.name,
      detectRenames: steps.lockDetectRenames,
    });
    await writeOut("capnwasm.lock", lockToJson(lock));
    report.steps.lock = { added: diff.added.length, removed: diff.removed.length, renamed: diff.renamed.length, unchanged: diff.unchanged };
  }

  // 4. emit-capnp ---------------------------------------------------
  let capnpText = null;
  if (steps.emitCapnp) {
    const { buildCapnp } = await import("./emit_capnp.mjs");
    const result = buildCapnp(manifest);
    capnpText = result.text;
    await writeOut(`${stem}.capnp`, capnpText);
    report.steps.emitCapnp = result.summary;
  }

  // 5. emit-openapi -------------------------------------------------
  if (steps.emitOpenapi) {
    const { buildOpenApiJson } = await import("./emit_openapi.mjs");
    const json = buildOpenApiJson(manifest);
    await writeOut(`${stem}.openapi.json`, json);
    report.steps.emitOpenapi = { bytes: json.length };
  }

  // 6. emit-agents --------------------------------------------------
  if (steps.emitAgents) {
    const mod = await import("./emit_agents.mjs");
    await writeOut("AGENTS.md", mod.buildAgentsMd(manifest));
    await writeOut("skill.md",  mod.buildSkillMd(manifest));
    await writeOut("llms.txt",  mod.buildLlmsTxt(manifest));
    report.steps.emitAgents = { files: 3 };
  }

  // 7. emit-codec ---------------------------------------------------
  if (steps.emitCodec) {
    const { buildCodec } = await import("./emit_codec.mjs");
    let structs = manifest.structs ?? [];
    if (!structs.some((s) => typeof s.dataWords === "number")) {
      // OpenAPI source: round-trip through the bundled capnp compiler
      // to materialize wire layouts.
      const { buildCapnp } = await import("./emit_capnp.mjs");
      const text = capnpText ?? buildCapnp(manifest).text;
      const bridge = await import("../bin/capnwasm.mjs");
      structs = await bridge.compileCapnpForCodec(text);
    }
    const result = buildCodec(manifest, { structs });
    await writeOut(`${stem}.codec.mjs`, result.text);
    report.steps.emitCodec = { emitted: result.summary.emitted.length, skipped: result.summary.skipped.length };
  }

  return report;
}

function countOperations(manifest) {
  return (manifest.interfaces ?? []).reduce((n, i) => n + (i.methods?.length ?? 0), 0)
       + (manifest.restApis   ?? []).reduce((n, a) => n + (a.methods?.length ?? 0), 0);
}

/**
 * Resolve config from a config file + CLI overrides. Used by the CLI
 * subcommand and any other caller that wants the same precedence.
 */
export async function loadConfig({ configPath, cli } = {}) {
  let fileCfg = {};
  if (configPath) {
    if (!existsSync(configPath)) throw new Error(`pipeline: config not found: ${configPath}`);
    fileCfg = JSON.parse(await readFile(configPath, "utf8"));
  }
  return {
    input: cli?.input ?? fileCfg.input,
    outputDir: cli?.outputDir ?? fileCfg.outputDir,
    lockIn: cli?.lockIn ?? fileCfg.lockIn,
    steps: { ...DEFAULT_STEPS, ...(fileCfg.steps ?? {}), ...(cli?.steps ?? {}) },
  };
}
