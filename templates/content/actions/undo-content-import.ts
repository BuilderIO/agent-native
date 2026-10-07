import {
  ActionContractError,
  defineAction,
  fail,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { ForbiddenError } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { importedBodyFingerprint } from "../server/lib/content-import.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import {
  lockDatabasesForTrash,
  trashDocumentSubtree,
} from "./delete-document.js";

export default defineAction({
  description:
    "Undo an import-content run by moving the pages it created to Trash. Only the person who ran the import can undo it, and it refuses with IMPORT_PAGE_CHANGED when any of those pages was edited, renamed, or given child pages since; use delete-document for a page you mean to discard anyway.",
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
        importedTitle: schema.documentImports.importedTitle,
        importedContentSha256: schema.documentImports.importedContentSha256,
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
    const importedIds = imported.map((page) => page.documentId);

    const trashedIds = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as ReturnType<typeof getDb>;
      const current = await tx
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          content: schema.documents.content,
          createdBy: schema.documents.createdBy,
          trashedAt: schema.documents.trashedAt,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.id, importedIds))
        .for("update");
      const children = await tx
        .select({ parentId: schema.documents.parentId })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.parentId, importedIds),
            isNull(schema.documents.trashedAt),
          ),
        );
      const databases = await tx
        .select({ documentId: schema.contentDatabases.documentId })
        .from(schema.contentDatabases)
        .where(inArray(schema.contentDatabases.documentId, importedIds));
      const extended = new Set([
        ...children.map((child) => child.parentId),
        ...databases.map((database) => database.documentId),
      ]);

      const live = current.filter((page) => !page.trashedAt);
      if (live.some((page) => page.createdBy?.toLowerCase() !== actor)) {
        throw new ForbiddenError(
          "Only the person who ran the import can undo it.",
        );
      }
      const changed = live.filter((page) => {
        const record = imported.find((row) => row.documentId === page.id)!;
        return (
          page.title !== record.importedTitle ||
          importedBodyFingerprint(page.content) !==
            record.importedContentSha256 ||
          extended.has(page.id)
        );
      });
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

      const trashed: string[] = [];
      for (const page of live) {
        const { ownerEmail } = imported.find(
          (row) => row.documentId === page.id,
        )!;
        const lockedDatabaseIds = await lockDatabasesForTrash(
          tx,
          page.id,
          ownerEmail,
        );
        trashed.push(
          ...(await trashDocumentSubtree(
            tx,
            page.id,
            ownerEmail,
            undefined,
            lockedDatabaseIds,
            ctx?.caller,
          )),
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
