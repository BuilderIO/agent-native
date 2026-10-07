import {
  ActionContractError,
  defineAction,
  fail,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { ForbiddenError } from "@agent-native/core/sharing";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { importedStateFingerprint } from "../server/lib/content-import.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
} from "./delete-document.js";

export default defineAction({
  description:
    "Undo an import-content run by moving the pages it created to Trash. Only the person who ran the import can undo it, and it refuses with IMPORT_PAGE_CHANGED when any of those pages was edited, renamed, moved, given a new icon or description, or given child pages since; use delete-document for a page you mean to discard anyway.",
  mcpTool: true,
  schema: z
    .object({
      importId: z
        .string()
        .min(1)
        .describe("The importId returned by import-content."),
    })
    .strict(),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ importId }, ctx) => {
    const actor = requireDocumentRequestActor(ctx);
    const db = getDb();
    const imported = await db
      .select({
        documentId: schema.documentImports.documentId,
        ownerEmail: schema.documentImports.ownerEmail,
        importedStateSha256: schema.documentImports.importedStateSha256,
      })
      .from(schema.documentImports)
      .where(eq(schema.documentImports.importId, importId));
    if (imported.length === 0) {
      fail("No pages were created by this import.", {
        errorCode: "IMPORT_NOT_FOUND",
        statusCode: 404,
      });
    }
    for (const page of imported) {
      await assertDocumentMutationAccess(page.documentId, "editor");
    }
    // An edit still in an open editor's save debounce must count as a change.
    for (const page of imported) {
      await flushOpenDocumentEditorToSql({
        documentId: page.documentId,
        ownerEmail: page.ownerEmail,
      });
    }
    const importedIds = new Set(imported.map((page) => page.documentId));

    const trashedIds = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as ReturnType<typeof getDb>;
      const current = await tx
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          content: schema.documents.content,
          description: schema.documents.description,
          icon: schema.documents.icon,
          parentId: schema.documents.parentId,
          spaceId: schema.documents.spaceId,
          createdBy: schema.documents.createdBy,
          trashedAt: schema.documents.trashedAt,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.id, [...importedIds]))
        .for("update");
      const collections = await tx
        .select({ documentId: schema.contentDatabases.documentId })
        .from(schema.contentDatabases)
        .where(inArray(schema.contentDatabases.documentId, [...importedIds]));
      const becameCollection = new Set(
        collections.map((collection) => collection.documentId),
      );

      const live = current.filter((page) => !page.trashedAt);
      if (live.some((page) => page.createdBy?.toLowerCase() !== actor)) {
        throw new ForbiddenError(
          "Only the person who ran the import can undo it.",
        );
      }
      const changed = live.filter((page) => {
        const record = imported.find((row) => row.documentId === page.id)!;
        return (
          becameCollection.has(page.id) ||
          importedStateFingerprint(page) !== record.importedStateSha256
        );
      });

      const trashed: string[] = [];
      for (const page of live) {
        if (changed.includes(page)) continue;
        const { ownerEmail } = imported.find(
          (row) => row.documentId === page.id,
        )!;
        const lockedDatabaseIds = await lockDatabasesForTrash(
          tx,
          page.id,
          ownerEmail,
        );
        const subtree = await trashDocumentSubtree(
          tx,
          page.id,
          ownerEmail,
          undefined,
          lockedDatabaseIds,
          ctx?.caller,
        );
        // A page someone nested under the import is theirs, not the import's.
        if (subtree.some((id) => !importedIds.has(id))) changed.push(page);
        trashed.push(...subtree);
      }
      if (changed.length > 0) {
        throw new ActionContractError(
          `${changed.map((page) => `"${page.title}"`).join(", ")} changed after the import, so no imported page was moved to Trash.`,
          {
            errorCode: "IMPORT_PAGE_CHANGED",
            statusCode: 409,
            details: { documentIds: changed.map((page) => page.id) },
          },
        );
      }
      return trashed;
    });

    if (trashedIds.length > 0) {
      await writeAppState("refresh-signal", { ts: Date.now() });
    }
    return {
      importId,
      trashedIds,
      message:
        trashedIds.length > 0
          ? `Moved ${trashedIds.length} imported page${trashedIds.length === 1 ? "" : "s"} to Trash.`
          : "The imported pages were already in Trash.",
    };
  },
});
