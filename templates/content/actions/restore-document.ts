import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { collectTrashRecoveryScope } from "./_trash-recovery-scope.js";
import { restoreDocumentSubtree } from "./delete-document.js";

export default defineAction({
  description: "Restore a page subtree from Trash.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
    destinationParentId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Explicit live destination in the same space; null selects the same-space root. Omit to preserve the original location.",
      ),
    scopeToken: z
      .string()
      .optional()
      .describe("Scope token returned by plan-content-trash-recovery."),
  }),
  run: async ({ id, destinationParentId, scopeToken }) => {
    const scope = await collectTrashRecoveryScope(getDb(), id, "restore");
    const restored = await getDb().transaction((tx) =>
      restoreDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        id,
        scope.root.ownerEmail,
        { destinationParentId, scopeToken: scopeToken ?? scope.token },
      ),
    );
    if (restored.length === 0) throw new Error("Document is not in Trash");

    return {
      success: true,
      restored: restored.length,
      documentId: id,
      affectedDocumentIds: restored,
      affectedDatabaseIds: scope.ownedDatabaseIds,
    };
  },
});
