import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  describePlanBlocksForAgent,
  renderPlanBlockVocabulary,
} from "../shared/plan-block-registry.js";

/**
 * Expose the live plan block vocabulary to the agent. The list is generated from
 * the block registry (`registerPlanBlocks`) — the same config the MDX adapter and
 * the browser renderer use — so the schema/tags the agent sees always match what
 * the app can actually render and round-trip. Surface it before authoring or
 * editing structured plan `content` so `/visual-plan` only emits valid blocks.
 */
export default defineAction({
  description:
    "List the structured plan block types the app can render and round-trip (type, MDX tag, placement, key data fields, JSON schema). Read this before writing structured plan content so the blocks you emit are valid. Generated from the live block registry.",
  schema: z.object({
    format: z
      .enum(["reference", "schema"])
      .optional()
      .default("reference")
      .describe(
        "`reference` returns a compact markdown table; `schema` returns the full per-block JSON schemas.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "List Plan Blocks",
    description:
      "List the plan block vocabulary (types, MDX tags, and schemas) the plan editor can render.",
  },
  run: async (args) => {
    const blocks = describePlanBlocksForAgent();
    return {
      reference: renderPlanBlockVocabulary(),
      ...(args.format === "schema" ? { blocks } : {}),
      count: blocks.length,
    };
  },
});
