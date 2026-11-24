import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { addSplit } from "../server/lib/add-split.js";
import { automationActionSchema } from "../shared/automation-schema.js";

const backfillOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("skipped") }),
  z.object({
    status: z.enum(["queued", "running", "completed"]),
    runId: z.string(),
  }),
  z.object({
    status: z.literal("failed"),
    runId: z.string().optional(),
    errorCode: z.string(),
    error: z.string(),
  }),
]);

const addSplitOutputSchema = z.object({
  created: z.boolean(),
  rule: z.object({
    id: z.string(),
    ownerEmail: z.string(),
    domain: z.string(),
    kind: z.enum(["automation", "ai-filter"]).optional(),
    name: z.string(),
    condition: z.string(),
    actions: z.array(automationActionSchema),
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  backfill: backfillOutputSchema,
  appView: z.object({ route: z.string() }),
});

export default defineAction({
  description:
    "Add a split: a named inbox view filled by an AI rule. Splits only match mail written by a person, never noreply, notification, or bot senders, so describe the topic or relationship, not specific senders. Returns the existing split when one with the same name exists. Backfills recent mail and reports the backfill status.",
  schema: z.object({
    name: z.string().describe("Split name, also its label"),
    condition: z
      .string()
      .describe("Natural-language description of what belongs in the split"),
    backfill: z
      .boolean()
      .optional()
      .describe("Apply the split to recent mail (default true)"),
  }),
  outputSchema: addSplitOutputSchema,
  mcpTool: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return addSplit(ownerEmail, args);
  },
});
