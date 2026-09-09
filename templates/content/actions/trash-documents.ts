import { ActionContractError, defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import type { TrashPageResult, TrashPagesResult } from "../shared/api.js";
import { collectDocumentTrashScope } from "./_document-trash-scope.js";
import deleteDocument from "./delete-document.js";

function failedResult(id: string, error: unknown): TrashPageResult {
  return {
    id,
    status: "failed",
    affectedDocumentIds: [],
    affectedDatabaseIds: [],
    error:
      error instanceof ActionContractError
        ? { code: error.errorCode, message: error.message }
        : {
            code: "DOCUMENT_TRASH_FAILED",
            message:
              "The page could not be moved to Trash. Check access and retry.",
          },
  };
}

export default defineAction({
  description:
    "Move selected canonical pages and their true children to Trash. Deduplicates overlapping selection, authorizes each subtree, and returns an explicit outcome per page. Each subtree is atomic; other selected pages can succeed when one fails. Membership-only pages and reference targets are not descendants. Restore successful roots with restore-document to undo.",
  schema: z.object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .describe("Canonical page IDs to move to Trash"),
  }),
  run: async ({ ids }): Promise<TrashPagesResult> => {
    const uniqueIds = [...new Set(ids)];
    const results = new Map<string, TrashPageResult>();
    const planned: Array<{ id: string; size: number }> = [];
    for (const id of uniqueIds) {
      try {
        const access = await assertAccess("document", id, "admin");
        const scope = await collectDocumentTrashScope(
          getDb(),
          id,
          access.resource.ownerEmail as string,
        );
        planned.push({ id, size: scope.documentIds.length });
      } catch (error) {
        results.set(id, failedResult(id, error));
      }
    }
    const affectedDocumentIds = new Set<string>();
    const affectedDatabaseIds = new Set<string>();
    for (const { id } of planned.sort((a, b) => b.size - a.size)) {
      try {
        await assertAccess("document", id, "admin");
        if (affectedDocumentIds.has(id)) {
          results.set(id, {
            id,
            status: "covered",
            affectedDocumentIds: [],
            affectedDatabaseIds: [],
          });
          continue;
        }
        const result = await deleteDocument.run({ id });
        result.affectedDocumentIds.forEach((documentId) =>
          affectedDocumentIds.add(documentId),
        );
        result.affectedDatabaseIds.forEach((databaseId) =>
          affectedDatabaseIds.add(databaseId),
        );
        results.set(id, {
          id,
          status: result.deleted > 0 ? "trashed" : "already-trashed",
          affectedDocumentIds: result.affectedDocumentIds,
          affectedDatabaseIds: result.affectedDatabaseIds,
        });
      } catch (error) {
        results.set(id, failedResult(id, error));
      }
    }
    return {
      results: uniqueIds.map((id) => {
        const result = results.get(id);
        if (!result) throw new Error("A selected page has no trash outcome.");
        return result;
      }),
      affectedDocumentIds: [...affectedDocumentIds],
      affectedDatabaseIds: [...affectedDatabaseIds],
    };
  },
});
