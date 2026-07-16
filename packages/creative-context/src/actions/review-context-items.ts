import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { serializePublicReviewItems } from "../server/public-serialization.js";
import { reviewContextItems } from "../store/index.js";

const schema = z.discriminatedUnion("operation", [
  z.object({
    sourceId: z.string().min(1),
    operation: z.literal("list"),
    queue: z.enum(["restricted", "all"]).default("restricted"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
  z.object({
    sourceId: z.string().min(1),
    operation: z.enum([
      "approve",
      "exclude",
      "exemplar",
      "normal",
      "ignore",
      "star",
      "unstar",
      "deprecate",
      "restore",
    ]),
    itemIds: z.array(z.string().min(1)).min(1).max(500),
  }),
]);

const agentInputSchema = z.object({
  sourceId: z.string().min(1),
  operation: z.enum([
    "list",
    "approve",
    "exclude",
    "exemplar",
    "normal",
    "ignore",
    "star",
    "unstar",
    "deprecate",
    "restore",
  ]),
  queue: z.enum(["restricted", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  itemIds: z.array(z.string().min(1)).min(1).max(500).optional(),
});

export default defineAction({
  description:
    "List pending restricted metadata without content, or approve/exclude selected items after user confirmation.",
  schema,
  agentInputSchema,
  needsApproval: (args) => args.operation !== "list",
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: async (input) => {
    const result = await reviewContextItems(input);
    return {
      ...result,
      items: serializePublicReviewItems(result.items),
    };
  },
});
