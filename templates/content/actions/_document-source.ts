import { ActionContractError } from "@agent-native/core/action";
import { alias } from "@agent-native/core/db/schema";
import { and, eq, exists, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { DocumentSourceInfo } from "../shared/api.js";
import { GITHUB_PULL_REQUESTS_SOURCE_TYPE } from "../shared/github-pull-requests.js";
import {
  githubFileWebUrl,
  parseGitHubSourceTable,
} from "../shared/github-source.js";
import { chunks } from "./_batch-utils.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";

interface DocumentSourceColumns {
  sourceMode?: string | null;
  sourceKind?: string | null;
  sourcePath?: string | null;
  sourceAbsolutePath?: string | null;
  sourceRootPath?: string | null;
  sourceUpdatedAt?: string | null;
}

export function linkedNestedLocalFile(
  db: ReturnType<typeof getDb>,
  databaseId?: string,
) {
  const items = alias(schema.contentDatabaseItems, "linked_local_file_items");
  const rows = schema.contentDatabaseSourceRows;
  const sources = schema.contentDatabaseSources;
  return sql<boolean>`coalesce(${and(
    eq(schema.documents.sourceMode, "local-files"),
    eq(schema.documents.sourceKind, "file"),
    sql`${schema.documents.sourcePath} ~ ${"^[^/]+(/[^/]+)+$"}`,
    sql`${schema.documents.sourcePath} !~ ${"(^|/)[.][.]?(/|$)"}`,
    exists(
      db
        .select({ id: rows.id })
        .from(rows)
        .innerJoin(sources, eq(sources.id, rows.sourceId))
        .innerJoin(
          items,
          and(
            eq(items.id, rows.databaseItemId),
            eq(items.documentId, rows.documentId),
            eq(items.databaseId, sources.databaseId),
          ),
        )
        .where(
          and(
            eq(rows.documentId, schema.documents.id),
            eq(sources.sourceType, "local-folder"),
            eq(sources.sourceTable, schema.documents.sourceRootPath),
            databaseId ? eq(sources.databaseId, databaseId) : undefined,
          ),
        ),
    ),
  )}, false)`;
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
        ? `This page follows a file${file}, so it stays in its collection.`
        : `This page follows a file in GitHub and is view only here. Edit the file${file}; Content updates after each push.`,
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

export async function assertLocalFolderAllowsPageEdit(
  document: DocumentSourceColumns & { id: string },
  change: "edit" | "trash" | "move" = "edit",
  db: ReturnType<typeof getDb> = getDb(),
) {
  if (
    document.sourceMode !== "local-files" ||
    document.sourceKind !== "file" ||
    !document.sourceRootPath
  ) {
    return;
  }
  const links = await db
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
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
        eq(schema.contentDatabaseSourceRows.documentId, document.id),
        eq(schema.contentDatabaseSources.sourceType, LOCAL_FOLDER_SOURCE_TYPE),
        eq(schema.contentDatabaseSources.sourceTable, document.sourceRootPath),
      ),
    );
  const owner = links
    .map((link) => localFolderOwner(link.metadataJson))
    .find((metadata) => metadata !== null);
  if (owner === undefined) return;
  const folder = owner.label ? `the folder "${owner.label}"` : "a folder";
  throw new ActionContractError(
    change === "trash"
      ? `This page is owned by ${folder} on a device. Delete its file in that folder on that device, and Content moves the page out of the folder after it syncs.`
      : change === "move"
        ? `This page is owned by ${folder} on a device, so it stays where its file is. Move the file in that folder on that device.`
        : `This page is owned by ${folder} on a device and must be edited there. Open the folder in Content on that device; this copy updates after it syncs.`,
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

function localFolderOwner(metadataJson: string) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    throw new ActionContractError(
      "This page's local folder link can't be read, so Content can't tell whether the folder owns it.",
      { errorCode: "SOURCE_METADATA_UNREADABLE", statusCode: 500 },
    );
  }
  if (!metadata || typeof metadata !== "object") return null;
  const { truthPolicy, connectionLabel } = metadata as Record<string, unknown>;
  if (truthPolicy !== "source_primary") return null;
  return {
    label: typeof connectionLabel === "string" ? connectionLabel : null,
  };
}

/**
 * A GitHub folder or pull request search decides its collection's rows and
 * columns, so the general source settings (another source, roles, column
 * bindings) don't apply.
 */
export function assertNotGitHubSource(
  source: { sourceType: string } | null | undefined,
) {
  if (source?.sourceType === GITHUB_PULL_REQUESTS_SOURCE_TYPE) {
    throw new ActionContractError(
      "This collection follows GitHub pull requests, which decide its rows and columns, so its source settings can't change here.",
      { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
    );
  }
  if (source?.sourceType !== "github") return;
  throw new ActionContractError(
    "This collection follows a GitHub folder, which decides its rows and columns, so its source settings can't change here.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A collection linked to a GitHub folder gets its rows from the folder's
 * files, and one linked to pull requests from those pull requests, so
 * Content doesn't add rows of its own to either.
 */
export async function assertCollectionAcceptsNewRows(
  databaseId: string,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const [linked] = await db
    .select({ sourceType: schema.contentDatabaseSources.sourceType })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        inArray(schema.contentDatabaseSources.sourceType, [
          "github",
          GITHUB_PULL_REQUESTS_SOURCE_TYPE,
        ]),
      ),
    )
    .limit(1);
  if (!linked) return;
  throw new ActionContractError(
    linked.sourceType === GITHUB_PULL_REQUESTS_SOURCE_TYPE
      ? "This collection follows GitHub pull requests, so its rows come from GitHub. Add a pull request by its link with add-github-pull-requests."
      : "This collection follows a GitHub folder, so its rows come from the files there. Add a Markdown file in GitHub; Content adds the row after the next push.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A collection that follows a GitHub folder holds only pages that follow its
 * files. A page restored from Trash into one has no file there: the sync
 * moved it to Trash when its file left, or it was in Trash before the link.
 * It comes back with its comments, History and sub-pages as an ordinary page,
 * out of the collection's rows, as a local folder sync leaves a page whose
 * file is gone. Rows restored along with their collection stay rows. It takes
 * the collection's lock, as each sync write does, so a sync never writes a
 * page from a record this deletes; call it before the restore's other writes.
 *
 * A pull request collection's row stays its pull request's row in Trash
 * while the link's record of it does. Once the sync drops that record, as it
 * does when the search stops finding the pull request, the page comes back
 * the same way, so the collection never holds a copy that no longer follows
 * GitHub beside the row the pull request gets if it returns.
 */
export async function releaseRestoredPagesFromGitHubCollections(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  ownerEmail: string,
  now: string,
): Promise<string[]> {
  const restored = new Set(documentIds);
  const releasedFrom = new Set<string>();
  const locked = new Set<string>();
  for (const batch of chunks(documentIds, 90)) {
    const memberships = await db
      .select({
        itemId: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
        databaseId: schema.contentDatabaseItems.databaseId,
        databaseDocumentId: schema.contentDatabases.documentId,
        sourceId: schema.contentDatabaseSources.id,
        sourceType: schema.contentDatabaseSources.sourceType,
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
          inArray(schema.contentDatabaseSources.sourceType, [
            "github",
            GITHUB_PULL_REQUESTS_SOURCE_TYPE,
          ]),
        ),
      )
      .where(inArray(schema.contentDatabaseItems.documentId, batch));
    for (const membership of memberships) {
      if (restored.has(membership.databaseDocumentId)) continue;
      if (!locked.has(membership.databaseId)) {
        await lockContentDatabaseMutation(db, membership.databaseId);
        locked.add(membership.databaseId);
      }
      if (
        membership.sourceType === GITHUB_PULL_REQUESTS_SOURCE_TYPE &&
        (await stillFollowsSource(db, membership))
      ) {
        continue;
      }
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

/** Whether the link still has its record of a row's page. */
async function stillFollowsSource(
  db: ReturnType<typeof getDb>,
  row: { sourceId: string; documentId: string },
) {
  const [record] = await db
    .select({ id: schema.contentDatabaseSourceRows.id })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, row.sourceId),
        eq(schema.contentDatabaseSourceRows.documentId, row.documentId),
      ),
    )
    .limit(1);
  return Boolean(record);
}
