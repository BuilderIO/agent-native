import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  invalidateLocalFileDocumentsCache,
  isContentLocalFileMode,
  removeContentLocalFileRoots,
} from "./_local-file-documents.js";
import { deleteDocumentRecursive } from "./delete-document.js";

async function removeImportedLocalSourceDocuments(
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
  const candidateIds = new Set(candidates.map((document) => document.id));
  const roots = candidates.filter(
    (document) => !document.parentId || !candidateIds.has(document.parentId),
  );
  let deleted = 0;

  for (const document of roots) {
    const access = await assertAccess("document", document.id, "admin");
    deleted += (
      await deleteDocumentRecursive(
        db,
        document.id,
        access.resource.ownerEmail as string,
      )
    ).length;
  }

  return { removed: deleted, roots: [] as string[], manifestPath: null };
}

export default defineAction({
  description:
    "Remove local-file sources from Content without deleting the files on disk. In local-file mode this unlinks configured Content roots from agent-native.json; in database mode this removes imported local-file document entries.",
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
    const result = (await isContentLocalFileMode())
      ? await removeContentLocalFileRoots(sourceRootPath)
      : await removeImportedLocalSourceDocuments(sourceRootPath);

    if (result.removed === 0 && result.roots.length === 0) {
      throw new Error(
        sourceRootPath
          ? "No matching local file source was found."
          : "No local file sources were found to remove.",
      );
    }

    invalidateLocalFileDocumentsCache();
    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      success: true,
      deleted: result.removed,
      removedRoots: result.roots,
      manifestPath: result.manifestPath,
    };
  },
});
