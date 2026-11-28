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
import {
  LOCAL_FOLDER_SOURCE_TYPE,
  localFolderTruthPolicy,
} from "./_local-folder-source.js";

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

type LocalFolderChange = "edit" | "trash" | "move";

export async function assertLocalFolderAllowsPageEdit(
  document: DocumentSourceColumns & { id: string },
  change: LocalFolderChange = "edit",
  db: ReturnType<typeof getDb> = getDb(),
) {
  if (document.sourceMode !== "local-files" || document.sourceKind !== "file")
    return;
  const label = (await localFolderOwners(db, [document.id])).get(document.id);
  if (label !== undefined) throw localFolderOwnsPage(label, change);
}

export async function assertLocalFolderAllowsPagesEdit(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  change: "edit" | "trash" = "edit",
  { rootId }: { rootId?: string } = {},
) {
  const owners = await localFolderOwners(db, documentIds);
  const first = owners.values().next();
  if (first.done) return;
  const rootLabel = rootId === undefined ? undefined : owners.get(rootId);
  throw localFolderOwnsPage(
    rootLabel === undefined ? first.value : rootLabel,
    change,
    {
      nested: rootId !== undefined && rootLabel === undefined,
      documentIds: [...owners.keys()],
    },
  );
}

async function localFolderOwners(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
) {
  const documents = schema.documents;
  const owners = new Map<string, string | null>();
  for (const batch of chunks([...new Set(documentIds)], 500)) {
    // guard:allow-unscoped — callers have checked access to these pages; this reads only which folder links own them.
    const pages = await db
      .select({
        id: documents.id,
        sourceMode: documents.sourceMode,
        sourceKind: documents.sourceKind,
      })
      .from(documents)
      .where(
        and(
          inArray(documents.id, batch),
          eq(documents.sourceMode, "local-files"),
          eq(documents.sourceKind, "file"),
        ),
      );
    const files = pages
      .filter(
        (page) =>
          page.sourceMode === "local-files" && page.sourceKind === "file",
      )
      .map((page) => page.id);
    if (files.length === 0) continue;
    const sources = schema.contentDatabaseSources;
    const sourceRows = schema.contentDatabaseSourceRows;
    // guard:allow-unscoped — callers have checked access to these pages; this reads only which folder links own them.
    const links = await db
      .select({
        documentId: documents.id,
        metadataJson: sources.metadataJson,
      })
      .from(documents)
      .innerJoin(sourceRows, eq(sourceRows.documentId, documents.id))
      .innerJoin(
        sources,
        and(
          eq(sources.id, sourceRows.sourceId),
          eq(sources.sourceType, LOCAL_FOLDER_SOURCE_TYPE),
        ),
      )
      .innerJoin(
        schema.contentDatabases,
        and(
          eq(schema.contentDatabases.id, sources.databaseId),
          eq(schema.contentDatabases.spaceId, documents.spaceId),
        ),
      )
      .where(
        and(
          inArray(documents.id, files),
          eq(documents.sourceMode, "local-files"),
          eq(documents.sourceKind, "file"),
        ),
      );
    for (const link of links) {
      const settings = localFolderSettings(link.metadataJson);
      if (
        settings.truthPolicy === "source_primary" &&
        !owners.has(link.documentId)
      )
        owners.set(link.documentId, settings.label);
    }
  }
  return owners;
}

function localFolderSettings(metadataJson: string) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    throw new ActionContractError(
      "This page's local folder link can't be read, so Content can't tell whether the folder owns it.",
      { errorCode: "SOURCE_METADATA_UNREADABLE", statusCode: 500 },
    );
  }
  const { truthPolicy, connectionLabel } =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    truthPolicy: localFolderTruthPolicy(truthPolicy),
    label: typeof connectionLabel === "string" ? connectionLabel : null,
  };
}

function localFolderOwnsPage(
  label: string | null,
  change: LocalFolderChange,
  details?: { nested: boolean; documentIds: string[] },
) {
  const folder = label ? `the folder "${label}"` : "a folder";
  return new ActionContractError(
    details?.nested
      ? `Pages inside this one are owned by ${folder} on a device. Delete their files in that folder on that device first; Content removes them after it syncs.`
      : change === "trash"
        ? `This page is owned by ${folder} on a device. Delete its file in that folder on that device, and Content moves the page out of the folder after it syncs.`
        : change === "move"
          ? `This page is owned by ${folder} on a device, so it stays where its file is. Move the file in that folder on that device.`
          : `This page is owned by ${folder} on a device and must be edited there. Open the folder in Content on that device; this copy updates after it syncs.`,
    {
      errorCode: "SOURCE_READ_ONLY",
      statusCode: 409,
      ...(details ? { details: { documentIds: details.documentIds } } : {}),
    },
  );
}

export function isSourceReadOnlyRefusal(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError &&
    error.errorCode === "SOURCE_READ_ONLY"
  );
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
export async function releaseRestoredPagesFromSourceCollections(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  ownerEmail: string,
  now: string,
  { keepLocalFolderPages = false }: { keepLocalFolderPages?: boolean } = {},
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
        sourceTable: schema.contentDatabaseSources.sourceTable,
        pageSourceMode: schema.documents.sourceMode,
        pageSourceRootPath: schema.documents.sourceRootPath,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .innerJoin(
        schema.contentDatabaseSources,
        and(
          eq(
            schema.contentDatabaseSources.databaseId,
            schema.contentDatabaseItems.databaseId,
          ),
          inArray(
            schema.contentDatabaseSources.sourceType,
            keepLocalFolderPages
              ? ["github", GITHUB_PULL_REQUESTS_SOURCE_TYPE]
              : [
                  "github",
                  GITHUB_PULL_REQUESTS_SOURCE_TYPE,
                  LOCAL_FOLDER_SOURCE_TYPE,
                ],
          ),
        ),
      )
      .where(inArray(schema.contentDatabaseItems.documentId, batch));
    for (const membership of memberships) {
      if (restored.has(membership.databaseDocumentId)) continue;
      const localFolder = membership.sourceType === LOCAL_FOLDER_SOURCE_TYPE;
      if (
        localFolder &&
        (membership.pageSourceMode !== "local-files" ||
          membership.sourceTable !== membership.pageSourceRootPath)
      ) {
        continue;
      }
      if (!locked.has(membership.databaseId)) {
        await lockContentDatabaseMutation(db, membership.databaseId);
        locked.add(membership.databaseId);
      }
      if (
        (localFolder ||
          membership.sourceType === GITHUB_PULL_REQUESTS_SOURCE_TYPE) &&
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
            inArray(schema.documents.sourceMode, ["github", "local-files"]),
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
