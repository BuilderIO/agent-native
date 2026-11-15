import {
  recordChange,
  runWithRequestContext,
  type RecurringSweepContext,
} from "@agent-native/core/server";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { GITHUB_PULL_REQUESTS_SOURCE_TYPE } from "../shared/github-pull-requests.js";
import { readGitHubPullRequestsState } from "./_github-pull-requests-metadata.js";
import {
  githubPullRequestsSyncChangedRows,
  syncGitHubPullRequests,
  waitForGitHubPullRequestsSync,
  type GitHubPullRequestsSyncResult,
} from "./_github-pull-requests-source.js";

/**
 * A link checked longer ago than this checks GitHub before it's read, as a
 * GitHub folder does. A failed check counts, so an outage slows a read at
 * most once a minute.
 */
export const GITHUB_PULL_REQUESTS_STALE_MS = 60_000;
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

export interface GitHubPullRequestsLink {
  sourceId: string;
  databaseDocumentId: string;
  orgId: string | null;
  metadataJson: string;
  lastRefreshedAt: string | null;
}

function checkedWithin(lastRefreshedAt: string | null, ms: number) {
  const at = lastRefreshedAt ? Date.parse(lastRefreshedAt) : NaN;
  return Number.isFinite(at) && Date.now() - at < ms;
}

function linkState(metadataJson: string | undefined) {
  try {
    return readGitHubPullRequestsState(JSON.parse(metadataJson ?? ""));
  } catch {
    // coercion-ok: a link whose metadata can't be read has no state; the sweep passes it by.
    return null;
  }
}

/** What the Sources panel shows about a link, as one comparable string. */
function statusShown(metadataJson: string | undefined) {
  const state = linkState(metadataJson);
  return JSON.stringify([
    state?.rows ?? null,
    state?.searchTotal ?? null,
    state?.problem?.code ?? null,
    state?.problem?.message ?? null,
  ]);
}

async function readStatusShown(sourceId: string) {
  const [source] = await getDb()
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId))
    .limit(1);
  return statusShown(source?.metadataJson);
}

/**
 * Tells everyone who can read the collection that its rows or status
 * changed, as a refresh of its source would, so open pages and tables
 * update in place.
 */
export function announceGitHubPullRequestsChange(
  databaseDocumentId: string,
  owner: string | null,
) {
  recordChange({
    source: "action",
    type: "change",
    key: "refresh-content-database-source",
    ...(owner ? { owner } : {}),
    ...documentChangeResource(databaseDocumentId),
  });
}

/** For a sync nobody asked for that changed rows or the status line. */
async function announceSync(
  link: GitHubPullRequestsLink,
  owner: string | null,
  result: GitHubPullRequestsSyncResult,
) {
  if (result.state === "busy") return;
  if (
    !githubPullRequestsSyncChangedRows(result) &&
    statusShown(link.metadataJson) === (await readStatusShown(link.sourceId))
  ) {
    return;
  }
  announceGitHubPullRequestsChange(link.databaseDocumentId, owner);
}

/**
 * Checks GitHub before a read of a pull request collection, or one of its
 * pages, when the link hasn't been checked for a minute. Never fails the
 * read. True when a sync changed or may have changed rows, so the caller
 * reads again.
 */
export async function refreshGitHubPullRequestsBeforeRead(
  link: GitHubPullRequestsLink,
) {
  if (checkedWithin(link.lastRefreshedAt, GITHUB_PULL_REQUESTS_STALE_MS)) {
    return false;
  }
  const until = Date.now() + READ_SYNC_BUDGET_MS;
  let result: GitHubPullRequestsSyncResult;
  try {
    result = await syncGitHubPullRequests({
      sourceId: link.sourceId,
      budgetMs: READ_SYNC_BUDGET_MS,
    });
    if (result.state === "busy") {
      // Another read or the background sync is asking GitHub. Wait for it in
      // this read's time, then read again.
      await waitForGitHubPullRequestsSync(link.sourceId, until);
      return true;
    }
  } catch (error) {
    // coercion-ok: the read goes on with the rows Content has; the next read or background sync tries GitHub again.
    console.warn(
      "[github-pull-requests] check before read failed:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
  await announceSync(
    link,
    linkState(link.metadataJson)?.linkedBy || null,
    result,
  ).catch((error: unknown) => {
    console.warn(
      "[github-pull-requests] change event failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
  return githubPullRequestsSyncChangedRows(result);
}

/**
 * The background sync: brings every pull request collection up to GitHub,
 * so a merge shows within about a minute with no one asking. Each sync runs
 * as the person who linked the collection.
 */
export async function runGitHubPullRequestsSweep(
  context: RecurringSweepContext,
) {
  const checkedBefore = new Date(Date.now() - SWEEP_RECHECK_MS).toISOString();
  const due: GitHubPullRequestsLink[] = await getDb()
    .select({
      sourceId: schema.contentDatabaseSources.id,
      databaseDocumentId: schema.contentDatabases.documentId,
      orgId: schema.contentDatabases.orgId,
      metadataJson: schema.contentDatabaseSources.metadataJson,
      lastRefreshedAt: schema.contentDatabaseSources.lastRefreshedAt,
    })
    .from(schema.contentDatabaseSources)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseSources.databaseId),
    )
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(
          schema.contentDatabaseSources.sourceType,
          GITHUB_PULL_REQUESTS_SOURCE_TYPE,
        ),
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
      const owner = linkState(link.metadataJson)?.linkedBy || null;
      if (!owner) continue;
      try {
        const result = await runWithRequestContext(
          { userEmail: owner, ...(link.orgId ? { orgId: link.orgId } : {}) },
          () =>
            syncGitHubPullRequests({
              sourceId: link.sourceId,
              budgetMs: Math.min(SWEEP_SYNC_BUDGET_MS, remaining - 1_000),
              ...(context.signal ? { signal: context.signal } : {}),
            }),
        );
        await announceSync(link, owner, result);
      } catch (error) {
        // coercion-ok: one link's failure is recorded on that link by the sync; the rest still run.
        console.warn(
          `[github-pull-requests] background sync of ${link.sourceId} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SWEEP_CONCURRENCY, due.length) }, worker),
  );
}
