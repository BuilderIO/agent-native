import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { collectTrashRecoveryScope } from "./_trash-recovery-scope.js";
import {
  deleteTrashedDocumentSubtree,
  PermanentDeleteScopeChangedError,
} from "./delete-document.js";

const MAX_DELETE_SCOPE_ATTEMPTS = 3;

export default defineAction({
  description:
    "Permanently delete a document subtree that is already in Trash. This cannot be undone.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
    scopeToken: z
      .string()
      .optional()
      .describe(
        "Scope token from plan-content-trash-recovery; a changed selection is rejected.",
      ),
  }),
  run: async ({ id, scopeToken }) => {
    const access = await assertAccess("document", id, "admin");
    const db = getDb();
    const scope = await collectTrashRecoveryScope(db, id);
    let deleted: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_DELETE_SCOPE_ATTEMPTS; attempt += 1) {
      try {
        deleted = await db.transaction((tx) =>
          deleteTrashedDocumentSubtree(
            tx as unknown as ReturnType<typeof getDb>,
            id,
            access.resource.ownerEmail as string,
            scopeToken ?? scope.token,
          ),
        );
        break;
      } catch (error) {
        if (
          !(error instanceof PermanentDeleteScopeChangedError) ||
          attempt === MAX_DELETE_SCOPE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    if (!deleted) throw new Error("Document deletion did not complete.");
    return {
      success: true,
      deleted: deleted.length,
      affectedDocumentIds: deleted,
      affectedDatabaseIds: scope.ownedDatabaseIds,
    };
  },
});
