import {
  recordChange,
  runWithRequestContext,
  type RecurringSweepContext,
} from "@agent-native/core/server";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { GITHUB_SOURCE_TYPE } from "../shared/github-source.js";
import { readGitHubSourceState } from "./_github-source-metadata.js";
import {
  syncGitHubSource,
  waitForGitHubSync,
  type GitHubSyncResult,
} from "./_github-source.js";

/**
 * A link checked longer ago than this checks GitHub before it's read. A sync
 * that stopped partway through a push isn't a check, so the background sync
 * carries it on; a failed one is, so an outage slows a read at most once a
 * minute.
 */
export const GITHUB_SOURCE_STALE_MS = 60_000;
/** How long a read waits on GitHub; the background sync finishes the rest. */
const READ_SYNC_BUDGET_MS = 3_000;
/** One link's share of a background sync, which has 90 seconds in all. */
const SWEEP_SYNC_BUDGET_MS = 20_000;
/** Links the background sync checks at once. */
const SWEEP_CONCURRENCY = 4;
/** The background sync skips links a read or another sync checked this recently. */
const SWEEP_RECHECK_MS = 45_000;
/** Links one background sync reads, least recently checked first; the rest wait a minute. */
const SWEEP_MAX_LINKS = 200;
/**
 * A push too big for one run is the background sync's to carry on. A read
 * carries it on only when no run has moved it for this long, so a big push
 * slows a read at most once every two minutes.
 */
const PUSH_LEFT_TO_SWEEP_MS = 2 * 60_000;

interface GitHubLink {
  sourceId: string;
  databaseDocumentId: string;
  orgId: string | null;
  metadataJson: string;
  lastRefreshedAt: string | null;
}

const linkColumns = {
  sourceId: schema.contentDatabaseSources.id,
  databaseDocumentId: schema.contentDatabases.documentId,
  orgId: schema.contentDatabases.orgId,
  metadataJson: schema.contentDatabaseSources.metadataJson,
  lastRefreshedAt: schema.contentDatabaseSources.lastRefreshedAt,
};

const sourceDatabase = eq(
  schema.contentDatabases.id,
  schema.contentDatabaseSources.databaseId,
);

function checkedWithin(lastRefreshedAt: string | null, ms: number) {
  const at = lastRefreshedAt ? Date.parse(lastRefreshedAt) : NaN;
  return Number.isFinite(at) && Date.now() - at < ms;
}

function linkState(metadataJson: string | undefined) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson ?? "");
  } catch {
    // coercion-ok: a link whose metadata can't be read has no state; the sweep passes it by.
    return null;
  }
  return readGitHubSourceState(metadata);
}

function linkedBy(link: GitHubLink): string | null {
  return linkState(link.metadataJson)?.linkedBy || null;
}

/** What the collection's status line shows about a link, as one comparable string. */
function statusShown(metadataJson: string | undefined) {
  const state = linkState(metadataJson);
  return JSON.stringify([
    state?.syncedCommitSha ?? null,
    state?.pendingCommitSha ?? null,
    state?.progress?.done ?? null,
    state?.progress?.total ?? null,
    state?.problem?.code ?? null,
    state?.skippedCount ?? 0,
    state?.skipped.map((file) => `${file.reason}:${file.path}`) ?? [],
    state?.imagesWaiting ?? 0,
  ]);
}

/**
 * Reads what a link's status line shows now. Compare a reading from before a
 * sync with one from after to learn whether the sync changed it, like a new
 * problem or a few more files done.
 */
export async function readGitHubStatusShown(sourceId: string) {
  const [source] = await getDb()
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId))
    .limit(1);
  return statusShown(source?.metadataJson);
}

/** Whether a sync changed what the status line shows, like a new problem. */
async function statusChanged(link: GitHubLink) {
  return (
    statusShown(link.metadataJson) !==
    (await readGitHubStatusShown(link.sourceId))
  );
}

export function githubSyncChangedRows(result: GitHubSyncResult) {
  return result.created + result.updated + result.renamed + result.trashed > 0;
}

/**
 * Tells everyone who can read the collection that its rows or status changed.
 * It is the event the sync action sends, so open pages, tables, page lists,
 * Trash and the status line update in place. An action whose sync failed
 * sends it too, since a failed action sends no change event of its own.
 */
export function announceGitHubSyncChange(
  databaseDocumentId: string,
  owner: string | null,
) {
  recordChange({
    source: "action",
    type: "change",
    key: "sync-github-folder",
    ...(owner ? { owner } : {}),
    ...documentChangeResource(databaseDocumentId),
  });
}

/** For a sync nobody asked for that changed rows or the status line. */
async function announceSync(
  link: GitHubLink,
  owner: string | null,
  result: GitHubSyncResult,
) {
  if (result.state === "busy") return;
  if (!githubSyncChangedRows(result) && !(await statusChanged(link))) return;
  announceGitHubSyncChange(link.databaseDocumentId, owner);
}

async function syncBeforeRead(link: GitHubLink | undefined) {
  if (!link || checkedWithin(link.lastRefreshedAt, GITHUB_SOURCE_STALE_MS)) {
    return false;
  }
  const state = linkState(link.metadataJson);
  if (
    state?.pendingCommitSha &&
    checkedWithin(state.checkedAt, PUSH_LEFT_TO_SWEEP_MS)
  ) {
    return false;
  }
  const until = Date.now() + READ_SYNC_BUDGET_MS;
  let result: GitHubSyncResult;
  try {
    result = await syncGitHubSource({
      sourceId: link.sourceId,
      budgetMs: READ_SYNC_BUDGET_MS,
    });
    if (result.state === "busy") {
      // Another read or the background sync is checking GitHub. Wait for it
      // in this read's time, then read again: it may have changed rows even
      // if it hasn't finished. One carrying on a push won't finish in that
      // time, so the read goes on with what it has written.
      if (!result.commitSha) await waitForGitHubSync(link.sourceId, until);
      return true;
    }
  } catch (error) {
    // coercion-ok: the read goes on with the rows Content has; the next read or background sync tries GitHub again.
    console.warn(
      "[github-source] check before read failed:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
  // The rows changed either way, so the read rereads them even when telling
  // open pages fails.
  await announceSync(link, linkedBy(link), result).catch((error: unknown) => {
    console.warn(
      "[github-source] change event failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
  return githubSyncChangedRows(result);
}

/**
 * Checks GitHub before a collection read when its link hasn't been checked
 * for a minute, so a push since then is in what the read returns. Never fails
 * the read. Call it after the reader's access check.
 */
export async function refreshGitHubSourceBeforeRead(databaseId: string) {
  const [link] = await getDb()
    .select(linkColumns)
    .from(schema.contentDatabaseSources)
    .innerJoin(schema.contentDatabases, sourceDatabase)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceType, GITHUB_SOURCE_TYPE),
      ),
    )
    .limit(1);
  return syncBeforeRead(link);
}

/**
 * The same check for a read of one page that follows a GitHub file. True when
 * a sync changed or may have changed rows, so the caller reads the page again.
 */
export async function refreshGitHubPageBeforeRead(documentId: string) {
  const [link] = await getDb()
    .select(linkColumns)
    .from(schema.contentDatabaseSources)
    .innerJoin(schema.contentDatabases, sourceDatabase)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(
        schema.contentDatabaseItems.databaseId,
        schema.contentDatabaseSources.databaseId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        eq(schema.contentDatabaseSources.sourceType, GITHUB_SOURCE_TYPE),
      ),
    )
    .limit(1);
  return syncBeforeRead(link);
}

/**
 * The background sync: brings every linked collection up to its branch, so a
 * push arrives within about a minute with no one asking. An unchanged branch
 * costs one conditional request, which GitHub doesn't count against the rate
 * limit. Each sync runs as the person who linked the folder.
 */
export async function runGitHubSourceSweep(context: RecurringSweepContext) {
  const checkedBefore = new Date(Date.now() - SWEEP_RECHECK_MS).toISOString();
  const due: GitHubLink[] = await getDb()
    .select(linkColumns)
    .from(schema.contentDatabaseSources)
    .innerJoin(schema.contentDatabases, sourceDatabase)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseSources.sourceType, GITHUB_SOURCE_TYPE),
        isNull(schema.contentDatabases.deletedAt),
        isNull(schema.documents.trashedAt),
        or(
          isNull(schema.contentDatabaseSources.lastRefreshedAt),
          lt(schema.contentDatabaseSources.lastRefreshedAt, checkedBefore),
        ),
      ),
    )
    // Never-checked links first in SQLite and Postgres alike.
    .orderBy(
      asc(sql`coalesce(${schema.contentDatabaseSources.lastRefreshedAt}, '')`),
    )
    .limit(SWEEP_MAX_LINKS);
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const link = due[next++]!;
      const remaining = context.deadlineAt - Date.now();
      if (context.signal?.aborted || remaining < 2_000) return;
      const owner = linkedBy(link);
      if (!owner) continue;
      try {
        const result = await runWithRequestContext(
          { userEmail: owner, orgId: link.orgId ?? undefined },
          () =>
            syncGitHubSource({
              sourceId: link.sourceId,
              budgetMs: Math.min(SWEEP_SYNC_BUDGET_MS, remaining - 1_000),
              signal: context.signal,
            }),
        );
        await announceSync(link, owner, result);
      } catch (error) {
        // coercion-ok: one link's failure is recorded on that link by the sync; the rest still run.
        console.warn(
          `[github-source] background sync of ${link.sourceId} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SWEEP_CONCURRENCY, due.length) }, worker),
  );
}
