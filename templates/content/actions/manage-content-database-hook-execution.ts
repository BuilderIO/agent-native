import { defineAction } from "@agent-native/core";
import {
  acknowledgeWorkflowExecution,
  getWorkflowExecution,
  retryWorkflowExecution,
  workflowExecutions,
  workflowSubscriptions,
} from "@agent-native/core/workflow";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  contentHookConfigFromJson,
  requireContentDatabaseAccess,
} from "./_content-database-hooks.js";

export default defineAction({
  description:
    "Retry or acknowledge an eligible Content hook execution. Only the database owner may resolve delivery uncertainty.",
  schema: z.object({
    action: z.enum(["retry", "acknowledge"]),
    databaseId: z.string().min(1),
    executionId: z.string().min(1),
  }),
  run: async ({ action, databaseId, executionId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const database = await requireContentDatabaseAccess(databaseId, "admin");
    if (database.ownerEmail !== ctx.userEmail) {
      throw new Error("Only the database owner can resolve hook executions.");
    }
    const [row] = await getDb()
      .select({ config: workflowSubscriptions.config })
      .from(workflowExecutions)
      .innerJoin(
        workflowSubscriptions,
        eq(workflowSubscriptions.id, workflowExecutions.subscriptionId),
      )
      .where(
        and(
          eq(workflowExecutions.id, executionId),
          eq(workflowSubscriptions.kind, "deterministic"),
        ),
      );
    const config = row ? contentHookConfigFromJson(row.config) : null;
    if (!config || config.databaseId !== databaseId) {
      throw new Error("Hook execution does not belong to this database.");
    }
    const changed =
      action === "retry"
        ? await retryWorkflowExecution({ executionId })
        : await acknowledgeWorkflowExecution({ executionId });
    if (!changed) {
      throw new Error(
        action === "retry"
          ? "Only failed or unknown executions can be retried."
          : "Only unknown executions can be acknowledged.",
      );
    }
    const execution = await getWorkflowExecution(executionId);
    if (!execution) {
      throw new Error("Hook execution changed but could not be reloaded.");
    }
    return { databaseId, execution };
  },
});
