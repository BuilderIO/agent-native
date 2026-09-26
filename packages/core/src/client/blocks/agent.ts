import { z } from "zod";

import type { BlockRegistry } from "./registry.js";
import type { BlockPlacement } from "./types.js";

export interface BlockAgentDoc {
  type: string;
  label: string;
  description: string;
  placement: BlockPlacement[];
  mdxTag: string;
  dataSchema: unknown;
  example?: unknown;
}

export function describeBlocksForAgent(
  registry: BlockRegistry,
): BlockAgentDoc[] {
  return registry
    .list()
    .map((spec) => ({
      type: spec.type,
      label: spec.label,
      description: spec.description,
      placement: spec.placement,
      mdxTag: spec.mdx.tag,
      dataSchema: safeJsonSchema(spec.schema),
      example: spec.empty?.(),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function safeJsonSchema(schema: z.ZodType<unknown>): unknown {
  try {
    return z.toJSONSchema(schema, { io: "input" });
  } catch {
    // Some schemas (recursive lazy, custom refinements) can't convert; the
    // agent still gets the type/label/description, which is the essential part.
    return undefined;
  }
}

export function renderBlockVocabularyReference(
  registry: BlockRegistry,
  options: { heading?: string } = {},
): string {
  const docs = describeBlocksForAgent(registry);
  const lines: string[] = [];
  if (options.heading) lines.push(options.heading, "");
  lines.push(
    "| type | mdx tag | placement | key data fields | description |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const doc of docs) {
    lines.push(
      `| \`${doc.type}\` | \`<${doc.mdxTag}>\` | ${doc.placement.join("+")} | ${
        summarizeFields(doc.dataSchema) || "—"
      } | ${escapeCell(doc.description)} |`,
    );
  }
  return lines.join("\n");
}

function summarizeFields(jsonSchema: unknown): string {
  if (!jsonSchema || typeof jsonSchema !== "object") return "";
  const obj = jsonSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!obj.properties) return "";
  const required = new Set(obj.required ?? []);
  return Object.keys(obj.properties)
    .map((key) => `\`${key}${required.has(key) ? "" : "?"}\``)
    .join(", ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
