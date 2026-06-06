import { z } from "zod";
import type { BlockRegistry } from "./registry.js";
import type { BlockPlacement } from "./types.js";

/**
 * Agent-facing description of one registered block. Generated from the registry
 * so the agent's block vocabulary always matches what the app can render and
 * serialize — no hand-maintained second list. React-free so an action / the
 * agent schema export can import it.
 */
export interface BlockAgentDoc {
  type: string;
  label: string;
  description: string;
  placement: BlockPlacement[];
  mdxTag: string;
  dataSchema: unknown;
  example?: unknown;
}

/** Describe every registered block for the agent (sorted by type for stability). */
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
