import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  proposeCreativeContextSuggestion,
  applyLayoutTemplateSuggestion,
} from "../store/index.js";

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("propose"),
    profileId: z.string().min(1).optional(),
    itemId: z.string().min(1),
    itemVersionId: z.string().min(1).optional(),
    reason: z.string().max(5000).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    operation: z.enum(["promote", "demote", "reject"]),
    suggestionId: z.string().min(1),
  }),
]);

const agentInputSchema = z.object({
  operation: z.enum(["propose", "promote", "demote", "reject"]),
  profileId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  itemVersionId: z.string().min(1).optional(),
  reason: z.string().max(5000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  suggestionId: z.string().min(1).optional(),
});

export default defineAction({
  description:
    "Propose, promote, demote, or reject a reusable layout-template suggestion pinned to an exact item version.",
  schema,
  agentInputSchema,
  needsApproval: (args) => args.operation !== "propose",
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: (args) =>
    args.operation === "propose"
      ? proposeCreativeContextSuggestion({
          ...args,
          kind: "layout-template",
        })
      : applyLayoutTemplateSuggestion({
          suggestionId: args.suggestionId,
          operation: args.operation,
        }),
});
