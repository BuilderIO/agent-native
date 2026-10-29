import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";

export default defineAction({
  description:
    "Editor only, not for the agent: deletes the signed-in person's own unsaved draft of a workflow. discarded is false when they had none, so a repeat is harmless. Another member's draft and the saved versions are untouched.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
  }),
  outputSchema: z.object({ discarded: z.boolean() }),
  http: { method: "POST" },
  // The end state is "no draft", wherever a repeat starts from.
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  audit: { enabled: false },
  run: async ({ factoryId, workflowId }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const discarded = await scoped.store.discardWorkflowDraft(
        scoped.scope,
        workflowId,
        scoped.userEmail,
      );
      return { discarded };
    }),
});
