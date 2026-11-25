import { defineAction, fail } from "@agent-native/core/action";
import { recordChange } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceStatusResponse,
} from "../shared/api.js";
import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";
import {
  claimBuilderCmsSourceRefresh,
  claimReadOnlySourceRefresh,
  getContentDatabaseSourceSnapshot,
  getContentDatabaseSourceSnapshotById,
  getExistingSourceForWrite,
  recordReadOnlySourceRefreshFailure,
  releaseBuilderCmsSourceRefreshClaim,
  resyncBuilderCmsSourceSnapshot,
  resyncMockSourceSnapshot,
  resolveDatabaseForSourceMutation,
  seedSecondarySourceFields,
  storeSecondarySourceRows,
  updateReadOnlySourceMetadata,
} from "./_database-source-utils.js";
import { announceGitHubPullRequestsChange } from "./_github-pull-requests-freshness.js";
import {
  githubPullRequestsSyncSummary,
  syncGitHubPullRequests,
} from "./_github-pull-requests-source.js";
import {
  announceGitHubSyncChange,
  githubSyncChangedRows,
  readGitHubStatusShown,
} from "./_github-source-freshness.js";
import { githubSyncSummary, syncGitHubSource } from "./_github-source.js";
import { serializeDatabase } from "./_property-utils.js";

export function sourceRefreshSummary(args: {
  snapshot: ContentDatabaseSource | null;
  githubSummary: string | null;
  skippedOverlappingRefresh: boolean;
  notionStoppedAt: number | null;
}): string {
  const { snapshot } = args;
  if (args.githubSummary) return args.githubSummary;
  if (!snapshot) return "Source metadata refreshed.";
  if (args.skippedOverlappingRefresh) {
    return `${snapshot.sourceName} already advanced or has another refresh in progress; the current snapshot was preserved.`;
  }
  if (snapshot.sourceType === "notion-database") {
    return args.notionStoppedAt === null
      ? `${snapshot.sourceName} refreshed read-only from Notion.`
      : `${snapshot.sourceName} refreshed read-only from Notion but stopped at ${args.notionStoppedAt} rows; more rows remain in Notion, and the next refresh reads on from there.`;
  }
  if (
    snapshot.sourceType === "builder-cms" &&
    (snapshot.metadata.sourceFetchState === "fetching" ||
      snapshot.syncState === "refreshing")
  ) {
    const fetched = snapshot.metadata.lastReadFetchedEntryCount;
    return `${snapshot.sourceName} fetched ${typeof fetched === "number" ? fetched : "some"} rows. Run refresh again to continue loading the remaining Builder rows.`;
  }
  return `${snapshot.sourceName} resynced locally; field mappings and row identity now reflect the current database snapshot.`;
}

function notionSweep(metadata: Record<string, unknown>) {
  const { notionSweepStartedAt: startedAt, notionSweepFrom: from } = metadata;
  return typeof startedAt === "string" && typeof from === "string"
    ? { startedAt, from }
    : null;
}

function announceSourceChange(databaseDocumentId: string) {
  try {
    const owner = getRequestUserEmail();
    recordChange({
      source: "action",
      type: "change",
      key: "refresh-content-database-source",
      ...(owner ? { owner } : {}),
      ...documentChangeResource(databaseDocumentId),
    });
  } catch (error) {
    console.warn(
      "[notion-source] change event failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export default defineAction({
  description:
    "Refresh the local read-only source status envelope for a content collection. Mock-local, Builder CMS, and Notion database sources resync field mappings and row identity without provider writes; GitHub folders sync rows to the branch's latest commit, and GitHub pull request collections to GitHub. For paginated Builder CMS or Notion sources, set fullRefresh to true to read a bounded multi-page snapshot in one action call.",
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    fullRefresh: z
      .boolean()
      .optional()
      .describe(
        "For paginated Builder CMS or Notion sources, read a bounded multi-page snapshot in this refresh.",
      ),
    finishBuilderPagination: z
      .boolean()
      .optional()
      .describe(
        "Internal Builder continuation mode. Read every remaining page from the persisted continuation offset.",
      ),
    expectedBuilderContinuationOffset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Internal Builder pagination guard. Continue only when the persisted source still expects this offset.",
      ),
  }),
  run: async (
    args,
  ): Promise<
    ContentDatabaseSourceStatusResponse & {
      /** Whether a GitHub sync changed what readers of the collection see. */
      githubChanged?: boolean;
      sourceRefreshed?: boolean;
    }
  > => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getExistingSourceForWrite(database.id, args.sourceId);
    if (!source) {
      return {
        database: serializeDatabase(database),
        mode: "local",
        summary: "Local / no source. Nothing to refresh.",
        source: null,
      };
    }

    const now = new Date().toISOString();
    let skippedOverlappingRefresh = false;
    let githubSummary: string | null = null;
    let githubChanged = false;
    let sourceRefreshed = false;
    let notionStoppedAt: number | null = null;
    if (source.sourceType === "github") {
      const shownBefore = await readGitHubStatusShown(source.id);
      const result = await syncGitHubSource({
        sourceId: source.id,
        budgetMs: args.fullRefresh === true ? 25_000 : 6_000,
        throwConnectionErrors: true,
        throwUnexpectedErrors: true,
      }).catch((error: unknown) => {
        // A sync that fails may have written rows first, and it stores the
        // problem on the link, so readers hear about it either way.
        try {
          announceGitHubSyncChange(
            database.documentId,
            getRequestUserEmail() ?? null,
          );
        } catch (announceError) {
          // The caller still gets the sync's error; other tabs catch up on their next read.
          console.warn(
            "[github-source] change event failed:",
            announceError instanceof Error
              ? announceError.message
              : String(announceError),
          );
        }
        throw error;
      });
      githubSummary = githubSyncSummary(source.sourceName, result);
      // The rows are written by now, so a status that can't be read back
      // counts as changed rather than failing the refresh.
      // coercion-ok: null differs from every reading, so readers look again.
      const shownAfter = await readGitHubStatusShown(source.id).catch(
        () => null,
      );
      githubChanged =
        githubSyncChangedRows(result) ||
        (result.state !== "busy" && shownAfter !== shownBefore);
    } else if (source.sourceType === "github-pull-requests") {
      const result = await syncGitHubPullRequests({
        sourceId: source.id,
        budgetMs: args.fullRefresh === true ? 25_000 : 10_000,
        throwConnectionErrors: true,
        throwUnexpectedErrors: true,
      }).catch((error: unknown) => {
        // A failed sync stores its problem on the link, so readers hear about it.
        try {
          announceGitHubPullRequestsChange(
            database.documentId,
            getRequestUserEmail() ?? null,
          );
        } catch (announceError) {
          console.warn(
            "[github-pull-requests] change event failed:",
            announceError instanceof Error
              ? announceError.message
              : String(announceError),
          );
        }
        throw error;
      });
      githubSummary = githubPullRequestsSyncSummary(result);
      // The Sources panel can change without a row changing, like a problem
      // that cleared, so every sync that ran tells readers.
      githubChanged = result.state !== "busy";
    } else if (source.sourceType === "mock-local") {
      await resyncMockSourceSnapshot({ database, source, now });
    } else if (source.sourceType === "builder-cms") {
      const claimedSource = await claimBuilderCmsSourceRefresh({
        source,
        expectedOffset: args.expectedBuilderContinuationOffset,
      });
      skippedOverlappingRefresh = !claimedSource;
      if (claimedSource) {
        await resyncBuilderCmsSourceSnapshot({
          database,
          source: claimedSource.source,
          now,
          runFullRefresh: args.fullRefresh === true,
          finishPagination: args.finishBuilderPagination === true,
          refreshClaimId: claimedSource.claimId,
        }).catch(async (error: unknown) => {
          await releaseBuilderCmsSourceRefreshClaim({
            sourceId: source.id,
            claimId: claimedSource.claimId,
          });
          throw error;
        });
        sourceRefreshed = true;
      }
    } else if (source.sourceType === "local-table") {
      // Read-only federated secondary; its rows are re-read on demand, nothing
      // to resync against the primary's local snapshot here.
    } else if (source.sourceType === "notion-database") {
      const claim = await claimReadOnlySourceRefresh({
        sourceId: source.id,
        now,
      });
      skippedOverlappingRefresh = !claim;
      if (claim) {
        const { claimId } = claim;
        try {
          const adapter = getContentDatabaseSourceAdapter("notion-database");
          if (!adapter) {
            fail("Notion sources can't be read here.", {
              errorCode: "source_adapter_missing",
              statusCode: 500,
            });
          }
          const sweep = notionSweep(claim.metadata);
          const read = await adapter.read({
            sourceTable: source.sourceTable,
            limit: 500,
            offset: 0,
            fullRefresh: args.fullRefresh === true,
            continueFrom: sweep?.from,
          });
          const capped = read.metadata?.hasMore === true;
          const stoppedAt = read.metadata?.lastCreatedTime;
          const continueFrom =
            capped && typeof stoppedAt === "string" && stoppedAt !== sweep?.from
              ? stoppedAt
              : null;
          await storeSecondarySourceRows({
            sourceId: source.id,
            ownerEmail: database.ownerEmail,
            sourceType: "notion-database",
            sourceTable: source.sourceTable,
            entries: read.entries,
            now,
            keepRowsNotRead: capped
              ? true
              : sweep
                ? { syncedSince: sweep.startedAt }
                : false,
            refreshClaimId: claimId,
          });
          await seedSecondarySourceFields({
            sourceId: source.id,
            ownerEmail: database.ownerEmail,
            sourceType: "notion-database",
            modelFields: read.fields,
            sampleEntry: read.entries[0],
            now,
          });
          await updateReadOnlySourceMetadata({
            sourceId: source.id,
            sourceType: "notion-database",
            sourceTable: source.sourceTable,
            fetchedAt: read.fetchedAt,
            now,
            message: read.message,
            metadata: {
              ...read.metadata,
              notionSweepStartedAt: continueFrom
                ? (sweep?.startedAt ?? now)
                : null,
              notionSweepFrom: continueFrom,
            },
            refreshClaimId: claimId,
          });
          if (capped) notionStoppedAt = read.entries.length;
          sourceRefreshed = true;
        } catch (error) {
          await recordReadOnlySourceRefreshFailure({
            sourceId: source.id,
            refreshClaimId: claimId,
            message: error instanceof Error ? error.message : String(error),
            now: new Date().toISOString(),
          }).catch((recordError: unknown) => {
            console.warn(
              "[notion-source] saving the refresh error failed:",
              recordError instanceof Error
                ? recordError.message
                : String(recordError),
            );
          });
          announceSourceChange(database.documentId);
          throw error;
        }
      }
    } else {
      throw new Error(`Unsupported source type "${source.sourceType}".`);
    }
    const snapshot = args.sourceId
      ? await getContentDatabaseSourceSnapshotById(database, args.sourceId)
      : await getContentDatabaseSourceSnapshot(database);

    return {
      database: serializeDatabase(database),
      mode: "source-backed",
      summary: sourceRefreshSummary({
        snapshot,
        githubSummary,
        skippedOverlappingRefresh,
        notionStoppedAt,
      }),
      source: snapshot,
      ...(source.sourceType === "github" ||
      source.sourceType === "github-pull-requests"
        ? { githubChanged }
        : {}),
      ...(sourceRefreshed ? { sourceRefreshed } : {}),
    };
  },
  // A GitHub sync that changed rows or the status line changed them for
  // everyone reading the collection, as with Sync now.
  changeResource: (_input, result) =>
    result.githubChanged || result.sourceRefreshed
      ? documentChangeResource(result.database.documentId)
      : null,
});
