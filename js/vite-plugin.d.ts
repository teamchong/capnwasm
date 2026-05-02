// Type declarations for capnwasm/vite-plugin.
// Hand-written so the plugin's public surface stays small and editor
// autocomplete is precise.

import type { Plugin } from "vite";

export interface CapnwasmPluginOptions {
  /**
   * Explicit list of schema files to generate. Each entry is either an
   * exact path (absolute or relative to Vite's project root) or a glob
   * pattern (`schemas/*.capnp`, `**\/api.ts`). When omitted, the plugin
   * auto-discovers every `**\/*.capnp` under the project root, skipping
   * `node_modules`, `dist`, `build`, `out`, `.vite`, `.cache`, `.next`,
   * `.turbo`, and `.git`.
   *
   * `.ts` files (with `@rest` directives) and OpenAPI specs (`.yaml` /
   * `.json`) must be listed explicitly. They are not auto-discovered
   * because most files with those extensions are not capnwasm schemas.
   */
  schemas?: string | string[];

  /**
   * Directory to write generated files into. By default outputs land
   * next to each schema source. `schemas/user.capnp` produces
   * `schemas/user.capnp.gen.mjs` and `schemas/user.capnp.gen.d.ts`.
   *
   * Resolved relative to Vite's project root.
   */
  outDir?: string;

  /**
   * Suffix appended to the schema's basename when computing the output
   * path. Defaults to `.gen.mjs`. The corresponding `.d.ts` is derived
   * by swapping the trailing `.mjs` (or `.js`) for `.d.ts`.
   *
   * Must start with a dot and end in `.mjs` or `.js`.
   */
  extension?: `.${string}.mjs` | `.${string}.js` | `.mjs` | `.js`;

  /**
   * If `true` (the default), a codegen failure during the initial
   * `buildStart` pass aborts the build with a single error listing every
   * schema that failed. Set to `false` to log errors but continue -
   * useful when one schema in a monorepo is broken and you want the
   * rest to still build.
   *
   * Per-schema errors during dev-mode hot reload are always logged to
   * the dev server's overlay regardless of this setting.
   */
  failOnError?: boolean;

  /**
   * Emit one log line per generated file. Defaults to `true`.
   */
  verbose?: boolean;
}

/**
 * Vite plugin that runs capnwasm codegen at build time and on schema
 * changes during dev. Drop into `vite.config.ts`:
 *
 * ```ts
 * import { capnwasm } from "capnwasm/vite-plugin";
 *
 * export default defineConfig({
 *   plugins: [capnwasm()],   // auto-discovers all .capnp files
 * });
 * ```
 */
export function capnwasm(options?: CapnwasmPluginOptions): Plugin;

export default capnwasm;
