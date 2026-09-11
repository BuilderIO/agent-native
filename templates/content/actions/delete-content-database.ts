import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { assertContentDatabaseLifecycleAccess } from "./_content-database-lifecycle.js";
import {
  runDatabaseSetupMutation,
  setupLifecycleSchema,
  setupError,
  refreshAfterSetup,
  setupAuditSummary,
} from "./_database-setup-mutation.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
} from "./delete-document.js";

export default defineAction({
  description:
    "Move one exact ordinary database to recoverable Trash using its fresh configuration revision and an idempotency key; preserve records for restoration and return a receipt.",
  mcpTool: true,
  mcpApp: { structuredContent: true },
  agentInputSchema: setupLifecycleSchema,
  schema: z.union([
    setupLifecycleSchema,
    z
      .object({
        databaseId: z.string().describe("Content database ID"),
      })
      .strict(),
  ]),
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "content-database",
      id: args.target?.databaseId ?? args.databaseId,
      visibility: "private",
    }),
    summary: (_args, result) =>
      setupAuditSummary(result, "Moved Content database to recoverable Trash"),
  },
  run: async (args, context) => {
    if (context?.caller === "mcp") setupLifecycleSchema.parse(args);
    if ("target" in args) {
      const input = setupLifecycleSchema.parse(args);
      const { database } = await assertContentDatabaseLifecycleAccess(
        input.target.databaseId,
      );
      let lockedIds: ReadonlySet<string> | undefined;
      const result = await runDatabaseSetupMutation({
        operation: "delete-content-database",
        input,
        payload: input,
        role: "admin",
        includeDeleted: true,
        lock: async (tx) => {
          lockedIds = await lockDatabasesForTrash(
            tx,
            database.documentId,
            database.ownerEmail,
          );
        },
        apply: async (tx, context) => {
          if (context.database.ownerDocumentId)
            setupError(
              "UNSUPPORTED_DATABASE",
              "Use the owning page to manage an inline database.",
              400,
            );
          const deletedAt =
            context.database.deletedAt ?? new Date().toISOString();
          const ids = context.database.deletedAt
            ? []
            : await trashDocumentSubtree(
                tx,
                context.database.documentId,
                context.database.ownerEmail,
                deletedAt,
                lockedIds,
              );
          return {
            outcome: context.database.deletedAt
              ? ("unchanged" as const)
              : ("trashed" as const),
            value: {
              databaseId: context.database.id,
              documentId: context.database.documentId,
              deletedAt,
              affectedDocumentIds: ids.slice(0, 100),
              affectedDocumentCount: ids.length,
              affectedDocumentIdsComplete: ids.length <= 100,
            },
          };
        },
      });
      await refreshAfterSetup(result.receipt);
      return { success: true, ...result.value, receipt: result.receipt };
    }
    const { databaseId } = args;
    const { database } = await assertContentDatabaseLifecycleAccess(databaseId);
    if (database.systemRole) {
      throw new Error("System Content databases cannot be deleted");
    }
    await assertAccess("document", database.documentId, "admin");
    const db = getDb();
    const deletedAt = database.deletedAt ?? new Date().toISOString();
    await db.transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const lockedDatabaseIds = await lockDatabasesForTrash(
        transactionDb,
        database.documentId,
        database.ownerEmail,
      );
      return trashDocumentSubtree(
        transactionDb,
        database.documentId,
        database.ownerEmail,
        deletedAt,
        lockedDatabaseIds,
      );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      databaseId,
      documentId: database.documentId,
      deletedAt,
    };
  },
});
