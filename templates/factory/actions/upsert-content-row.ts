import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { upsertContentRow } from "../server/connectors/content-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  outcome: z.enum(["created", "updated", "unchanged"]),
  documentId: z.string(),
  itemId: z.string(),
  url: z.string().nullable(),
});

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Add a row to an Agent-Native Content collection, or update the row whose unique key is key, for a workflow. It writes as the workflow's owner through their own Content connection (a connection shared with the workspace is not used), so it can only reach collections they can edit. collection is the collection's link or page ID; values maps column names to values and changes only those columns. When the owner has not connected Content the error is content_not_connected. When the error code ends in _outcome_unknown the row may have been written, so read the collection before trying again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    collection: z.string().trim().min(1).max(2_000),
    key: z.string().trim().min(1).max(500),
    title: z.string().max(500).optional(),
    values: z.record(z.string().min(1).max(200), z.unknown()).optional(),
  }),
  outputSchema: resultSchema,
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (_args: unknown, result: unknown) => {
      const id = (result as { documentId?: string } | undefined)?.documentId;
      return {
        type: "content-row",
        ...(id ? { id } : {}),
        visibility: "private",
      };
    },
    summary: (_args: unknown, result: unknown) => {
      const outcome = (result as { outcome?: string } | undefined)?.outcome;
      return outcome === "created"
        ? "Added a Content row"
        : outcome === "updated"
          ? "Updated a Content row"
          : outcome === "unchanged"
            ? "Checked a Content row"
            : "Tried to write a Content row";
    },
  },
  run: async (
    { factoryId: requestedFactoryId, collection, key, title, values },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return upsertContentRow(
      {
        identity: {
          userEmail: caller.userEmail,
          orgId: caller.orgId,
          factoryId: caller.factoryId,
          automationId: context?.automation?.triggerId,
          runId: context?.runId,
          callId: context?.toolCallId,
        },
        context,
      },
      { collection, key, title, values },
    );
  },
});
