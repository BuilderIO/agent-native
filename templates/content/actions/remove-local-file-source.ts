import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
async function unlinkImportedLocalSourceDocuments(
  sourceRootPath?: string | null,
) {
  const db = getDb();
  const clauses = [
    eq(schema.documents.sourceMode, "local-files"),
    eq(schema.documents.sourceKind, "file"),
  ];
  if (sourceRootPath) {
    clauses.push(eq(schema.documents.sourceRootPath, sourceRootPath));
  }

  const candidates = await db
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
    })
    .from(schema.documents)
    .where(
      and(...clauses, accessFilter(schema.documents, schema.documentShares)),
    );
  const trackedRows = candidates.length
    ? await db
        .select({ documentId: schema.contentDatabaseSourceRows.documentId })
        .from(schema.contentDatabaseSourceRows)
        .innerJoin(
          schema.contentDatabaseSources,
          eq(
            schema.contentDatabaseSources.id,
            schema.contentDatabaseSourceRows.sourceId,
          ),
        )
        .where(
          and(
            inArray(
              schema.contentDatabaseSourceRows.documentId,
              candidates.map((document) => document.id),
            ),
            eq(schema.contentDatabaseSources.sourceType, "local-folder"),
          ),
        )
    : [];
  const trackedDocumentIds = new Set(trackedRows.map((row) => row.documentId));
  const documentIds: string[] = [];
  for (const document of candidates) {
    if (trackedDocumentIds.has(document.id)) continue;
    await assertAccess("document", document.id, "admin");
    documentIds.push(document.id);
  }

  if (documentIds.length > 0) {
    const now = new Date().toISOString();
    await db
      .update(schema.documents)
      .set({
        sourceMode: "database",
        sourceKind: null,
        sourcePath: null,
        sourceRootPath: null,
        sourceUpdatedAt: now,
        updatedAt: now,
      })
      .where(inArray(schema.documents.id, documentIds));
  }

  return {
    removed: documentIds.length,
    roots: [] as string[],
    manifestPath: null,
  };
}

export default defineAction({
  description:
    "Unlink legacy local-file source metadata from SQL-backed Content pages without deleting either the pages or files on disk. Use disconnect-local-folder-source for connected folder adapters.",
  schema: z.object({
    sourceRootPath: z
      .string()
      .optional()
      .nullable()
      .describe(
        "Optional source root path to remove. Omit to remove all local-file sources visible in Content.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Remove local file source",
    description:
      "Unlink local-file entries from Content without deleting local Markdown or MDX files.",
  },
  run: async ({ sourceRootPath }) => {
    const result = await unlinkImportedLocalSourceDocuments(sourceRootPath);

    if (result.removed === 0 && result.roots.length === 0) {
      throw new Error(
        sourceRootPath
          ? "No matching local file source was found."
          : "No local file sources were found to remove.",
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      deleted: result.removed,
      removedRoots: result.roots,
      manifestPath: result.manifestPath,
    };
  },
});
