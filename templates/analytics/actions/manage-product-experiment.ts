import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { manageProductExperiment } from "../server/lib/product-experiments.js";
const experiment = z.object({
  name: z.string().min(1).max(160),
  hypothesis: z.string().max(2_000).optional(),
  appId: z.string().min(1),
  flagKey: z.string().min(1),
  primaryEventName: z.string().min(1).max(200),
  treatmentPercentage: z.number().int().min(1).max(99).optional(),
});
const experimentUpdate = experiment.pick({
  name: true,
  hypothesis: true,
  primaryEventName: true,
  treatmentPercentage: true,
});
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), experiment }),
  z.object({
    operation: z.literal("update"),
    id: z.string().uuid(),
    experiment: experimentUpdate.partial(),
  }),
  z.object({ operation: z.literal("start"), id: z.string().uuid() }),
  z.object({ operation: z.literal("pause"), id: z.string().uuid() }),
  z.object({ operation: z.literal("complete"), id: z.string().uuid() }),
  z.object({ operation: z.literal("emergency-off"), id: z.string().uuid() }),
  z.object({ operation: z.literal("reconcile"), id: z.string().uuid() }),
]);
export default defineAction({
  description:
    "Create or operate a product experiment. Starting makes the target rollout live before persisting running state; emergency off disables the target first.",
  schema,
  agentInputSchema: z.object({
    operation: z.enum([
      "create",
      "update",
      "start",
      "pause",
      "complete",
      "emergency-off",
      "reconcile",
    ]),
    id: z.string().optional(),
    experiment: experiment.partial().optional(),
  }),
  run: async (args, ctx) =>
    manageProductExperiment(await requireAnalyticsAdminContext(ctx), args),
});
