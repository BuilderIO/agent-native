import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import {
  WorkflowStoreError,
  type WorkflowDraftRecord,
} from "../server/workflow/adapter.js";

export default defineAction({
  description:
    "Editor only, not for the agent: reads the signed-in person's own unsaved draft of a workflow, as the graph's JSON text with the version it was based on. draft is null when they have none. A stored draft that no longer reads as a graph fails with draft_unreadable instead of returning null or a partial graph. Never returns another member's draft.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
  }),
  outputSchema: z.object({
    draft: z
      .object({
        baseVersion: z.number().int(),
        graph: z.string(),
        updatedAt: z.string(),
      })
      .nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  // Autosave moves this while the editor is open.
  dedupe: false,
  // A draft kept in the browser's cache could be restored after it was discarded.
  persistInBrowser: false,
  run: async ({ factoryId, workflowId }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      let draft: WorkflowDraftRecord | null;
      try {
        draft = await scoped.store.getWorkflowDraft(
          scoped.scope,
          workflowId,
          scoped.userEmail,
        );
      } catch (error) {
        if (
          error instanceof WorkflowStoreError &&
          error.code === "corrupt_record"
        ) {
          fail(
            `Your saved draft of workflow "${workflowId}" can no longer be read as a graph. Discard it to start again from the saved version.`,
            {
              errorCode: "draft_unreadable",
              statusCode: 422,
              details: { workflowId },
            },
          );
        }
        throw error;
      }
      return {
        draft: draft && {
          baseVersion: draft.baseVersion,
          graph: draft.graphJson,
          updatedAt: draft.updatedAt,
        },
      };
    }),
});
