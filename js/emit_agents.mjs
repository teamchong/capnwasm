// AGENTS.md / skill.md / llms.txt emitters.
//
// All three are agent-facing markdown / text formats that describe
// what an API exposes. The shapes differ:
//
//   AGENTS.md     long-form, one section per operation, emphasizes WHEN
//                 to use each tool and what to expect back.
//   skill.md      Anthropic-style skill manifest. Front-matter (name,
//                 description, allowed-tools) followed by an
//                 instruction body that references each tool by its
//                 MCP-namer name.
//   llms.txt      compact, one bullet per operation, optimized for
//                 prompt-context inclusion at the start of an agent's
//                 conversation.
//
// All three are generated from the same manifest, share the same
// description-resolution as `js/mcp.mjs` (extensions.agentDescription
// → method.summary → method.description → fallback), and stay in
// lockstep with the schema.

import { manifestToTools } from "./mcp.mjs";

/**
 * Build the canonical AGENTS.md content from a manifest.
 * @param {object} manifest
 * @param {object} [opts]
 * @param {string} [opts.title]   override the H1
 * @param {string} [opts.intro]   prose paragraph after the H1
 * @returns {string}
 */
export function buildAgentsMd(manifest, opts = {}) {
  const tools = manifestToTools(manifest);
  const title = opts.title ?? agentsTitle(manifest);
  const lines = [];
  lines.push(`# ${title}`);
  lines.push(``);
  if (opts.intro) {
    lines.push(opts.intro);
    lines.push(``);
  } else {
    lines.push(`Tool catalog for ${title}. ${tools.length} operation${tools.length === 1 ? "" : "s"}, generated from the canonical schema by \`npx capnwasm emit-agents\`.`);
    lines.push(``);
  }
  for (const t of tools) {
    lines.push(`## \`${t.name}\``);
    lines.push(``);
    lines.push(t.description);
    lines.push(``);
    const props = t.input_schema?.properties ?? {};
    const required = new Set(t.input_schema?.required ?? []);
    if (Object.keys(props).length > 0) {
      lines.push(`**Arguments:**`);
      for (const [name, schema] of Object.entries(props)) {
        const flag = required.has(name) ? "required" : "optional";
        lines.push(`- \`${name}\` (${flag}, ${jsonSchemaSummary(schema)}). ${schema.description ?? ""}`.trim());
      }
      lines.push(``);
    } else {
      lines.push(`*No arguments.*`);
      lines.push(``);
    }
  }
  return lines.join("\n");
}

/**
 * Build a skill.md (Anthropic skill format) from a manifest.
 *
 * The skill body lists each tool by its MCP-namer name with a one-line
 * directive. Front-matter declares the skill metadata.
 */
export function buildSkillMd(manifest, opts = {}) {
  const tools = manifestToTools(manifest);
  const name = opts.name ?? slugify(agentsTitle(manifest));
  const description = opts.description ?? `Operations for ${agentsTitle(manifest)} (${tools.length} tools, generated from the canonical schema).`;
  const lines = [];
  lines.push(`---`);
  lines.push(`name: ${name}`);
  lines.push(`description: ${jsonString(description)}`);
  lines.push(`---`);
  lines.push(``);
  lines.push(`# ${agentsTitle(manifest)}`);
  lines.push(``);
  lines.push(`Use the following tools for ${agentsTitle(manifest)} operations:`);
  lines.push(``);
  for (const t of tools) {
    lines.push(`- **\`${t.name}\`**. ${t.description}`);
  }
  lines.push(``);
  lines.push(`Each tool's schema is the canonical contract. Don't fabricate fields the schema doesn't declare; the operation will fail.`);
  return lines.join("\n");
}

/**
 * Build the llms.txt content from a manifest.
 *
 * llms.txt is a flat, prompt-context-friendly summary. One H2 per
 * surface, one bullet per operation, no nesting beyond that.
 */
export function buildLlmsTxt(manifest, opts = {}) {
  const tools = manifestToTools(manifest);
  const title = opts.title ?? agentsTitle(manifest);
  const lines = [];
  lines.push(`# ${title}`);
  lines.push(``);
  lines.push(`> ${tools.length} operation${tools.length === 1 ? "" : "s"}. Tool name → one-line description.`);
  lines.push(``);
  lines.push(`## Tools`);
  lines.push(``);
  for (const t of tools) {
    const oneLine = t.description.split("\n")[0].slice(0, 200);
    lines.push(`- ${t.name}: ${oneLine}`);
  }
  return lines.join("\n");
}

// --- Helpers ----------------------------------------------------------

function agentsTitle(manifest) {
  return manifest?.openapi?.info?.title
    ?? manifest?.metadata?.title
    ?? manifest?.restApis?.[0]?.name
    ?? manifest?.interfaces?.[0]?.name
    ?? "API";
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "api";
}

function jsonString(s) {
  return JSON.stringify(String(s));
}

function jsonSchemaSummary(schema) {
  if (!schema || typeof schema !== "object") return "any";
  if (Array.isArray(schema.type)) return schema.type.join("|");
  if (schema.type === "array") return `array of ${jsonSchemaSummary(schema.items ?? {})}`;
  if (schema.$ref) {
    const m = schema.$ref.match(/\/([^/]+)$/);
    return m ? m[1] : schema.$ref;
  }
  if (schema.enum) return `enum (${schema.enum.length} values)`;
  if (schema.type) return schema.type;
  if (schema.properties) return "object";
  return "any";
}
