import { ActionContractError } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { DocumentSourceInfo } from "../shared/api.js";
import {
  githubFileWebUrl,
  parseGitHubSourceTable,
} from "../shared/github-source.js";
import { chunks } from "./_batch-utils.js";

interface DocumentSourceColumns {
  sourceMode?: string | null;
  sourceKind?: string | null;
  sourcePath?: string | null;
  sourceAbsolutePath?: string | null;
  sourceRootPath?: string | null;
  sourceUpdatedAt?: string | null;
}

export function serializeDocumentSource(
  document: DocumentSourceColumns,
): DocumentSourceInfo | undefined {
  if (
    document.sourceMode !== "database" &&
    document.sourceMode !== "local-files" &&
    document.sourceMode !== "github"
  ) {
    return undefined;
  }

  const githubFolder =
    document.sourceMode === "github"
      ? parseGitHubSourceTable(document.sourceRootPath)
      : null;
  return {
    mode: document.sourceMode,
    kind: document.sourceKind ?? undefined,
    path: document.sourcePath ?? undefined,
    absolutePath: document.sourceAbsolutePath ?? undefined,
    rootPath: document.sourceRootPath ?? undefined,
    updatedAt: document.sourceUpdatedAt ?? undefined,
    ...(githubFolder && document.sourcePath
      ? { url: githubFileWebUrl(githubFolder, document.sourcePath) }
      : {}),
  };
}

/**
 * Pages that follow a GitHub file are written by sync only: their title,
 * body and description are edited in GitHub, and they leave Trash or enter
 * it as their files come and go. They stay where their collection puts them,
 * since a page moved under another one goes to Trash with it. Comments,
 * Content-only columns and the page icon stay editable.
 */
export function assertSourceAllowsPageEdit(
  document: DocumentSourceColumns,
  change: "edit" | "trash" | "move" = "edit",
) {
  if (document.sourceMode !== "github") return;
  const folder = parseGitHubSourceTable(document.sourceRootPath);
  const file =
    folder && document.sourcePath
      ? ` at ${githubFileWebUrl(folder, document.sourcePath)}`
      : " in GitHub";
  throw new ActionContractError(
    change === "trash"
      ? `This page follows a file in GitHub. Delete the file${file}, and Content moves the page to Trash after the push.`
      : change === "move"
        ? `This page follows a file in GitHub${file}, so it stays in its collection.`
        : `This page follows a file in GitHub and is view only here. Edit the file${file}; Content updates after each push.`,
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A GitHub folder decides its collection's rows and columns, so the general
 * source settings (another source, roles, column bindings) don't apply.
 */
export function assertNotGitHubSource(
  source: { sourceType: string } | null | undefined,
) {
  if (source?.sourceType !== "github") return;
  throw new ActionContractError(
    "This collection follows a GitHub folder, which decides its rows and columns, so its source settings can't change here.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A collection linked to a GitHub folder gets its rows from the folder's
 * files, so Content doesn't add rows of its own to it.
 */
export async function assertCollectionAcceptsNewRows(
  databaseId: string,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const [linked] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceType, "github"),
      ),
    )
    .limit(1);
  if (!linked) return;
  throw new ActionContractError(
    "This collection follows a GitHub folder, so its rows come from the files there. Add a Markdown file in GitHub; Content adds the row after the next push.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A collection that follows a GitHub folder holds only pages that follow its
 * files. A page restored from Trash into one has no file there: the sync
 * moved it to Trash when its file left, or it was in Trash before the link.
 * It comes back with its comments, History and sub-pages as an ordinary page,
 * out of the collection's rows, as a local folder sync leaves a page whose
 * file is gone. Rows restored along with their collection stay rows.
 */
export async function releaseRestoredPagesFromGitHubCollections(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  ownerEmail: string,
  now: string,
): Promise<string[]> {
  const restored = new Set(documentIds);
  const releasedFrom = new Set<string>();
  for (const batch of chunks(documentIds, 90)) {
    const memberships = await db
      .select({
        itemId: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
        databaseId: schema.contentDatabaseItems.databaseId,
        databaseDocumentId: schema.contentDatabases.documentId,
        sourceId: schema.contentDatabaseSources.id,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .innerJoin(
        schema.contentDatabaseSources,
        and(
          eq(
            schema.contentDatabaseSources.databaseId,
            schema.contentDatabaseItems.databaseId,
          ),
          eq(schema.contentDatabaseSources.sourceType, "github"),
        ),
      )
      .where(inArray(schema.contentDatabaseItems.documentId, batch));
    for (const membership of memberships) {
      if (restored.has(membership.databaseDocumentId)) continue;
      releasedFrom.add(membership.databaseId);
      await db
        .delete(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.id, membership.itemId));
      // The sync finds pages by this record, so the page would follow its
      // file again; it goes with the row.
      await db
        .delete(schema.contentDatabaseSourceRows)
        .where(
          and(
            eq(schema.contentDatabaseSourceRows.sourceId, membership.sourceId),
            eq(
              schema.contentDatabaseSourceRows.documentId,
              membership.documentId,
            ),
          ),
        );
      await db
        .update(schema.documents)
        .set({
          sourceMode: null,
          sourceKind: null,
          sourcePath: null,
          sourceRootPath: null,
          sourceUpdatedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.documents.id, membership.documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
            eq(schema.documents.sourceMode, "github"),
          ),
        );
    }
  }
  return [...releasedFrom];
}
