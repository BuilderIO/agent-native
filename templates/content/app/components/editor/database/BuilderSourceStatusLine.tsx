import type { ContentDatabaseSource } from "@shared/api";

import { Button } from "@/components/ui/button";

import { builderBodyHydrationDisplayHydratedCount } from "../body-hydration";
import {
  builderSourceContinuationFetchedCountDetail,
  builderSourceContinuationProgressPercent,
  builderSourceRowFetchStatus,
} from "./builder-source-progress";
import type { BuilderSourceProgressHighWater } from "./DatabaseView";
import { sourceRelativeTime, sourceUpdatedText } from "./source-status-text";
import { BuilderLogoMark } from "./SourceLogos";
import {
  SentenceWithName,
  SourceFacts,
  SourceStatusLine,
  useNow,
} from "./SourceStatusLine";
import { dbText } from "./text";

/**
 * Where a Builder model's rows have got to: still coming in, bodies still
 * syncing, or stopped by a failure. Null once everything is in.
 */
function builderProgress(
  source: ContentDatabaseSource,
  clientError: boolean,
  progressHighWater: BuilderSourceProgressHighWater | undefined,
) {
  const rowsComplete =
    source.metadata.lastReadHasMore === false ||
    progressHighWater?.rowsComplete === true;
  const rawStatus = clientError ? "error" : builderSourceRowFetchStatus(source);
  const status = rowsComplete && rawStatus === "fetching" ? null : rawStatus;
  const bodyHydration = source.bodyHydration;
  const rawFetchedCount =
    typeof source.metadata.lastReadFetchedEntryCount === "number"
      ? source.metadata.lastReadFetchedEntryCount
      : typeof source.metadata.lastReadEntryCount === "number"
        ? source.metadata.lastReadEntryCount
        : null;
  const hydratedCount = bodyHydration
    ? builderBodyHydrationDisplayHydratedCount({
        summary: bodyHydration,
        highWaterCount: progressHighWater?.hydratedCount ?? 0,
      })
    : 0;
  const fetchedCount =
    rowsComplete && bodyHydration
      ? Math.max(
          rawFetchedCount ?? 0,
          bodyHydration.total,
          progressHighWater?.fetchedCount ?? 0,
        )
      : rawFetchedCount;
  const hasMore = source.metadata.lastReadHasMore === true && !rowsComplete;
  const fetchedCountDetail = builderSourceContinuationFetchedCountDetail(
    source,
    fetchedCount,
    rowsComplete,
  );
  const hydrating =
    !hasMore &&
    !!bodyHydration &&
    bodyHydration.total > 0 &&
    bodyHydration.pending + bodyHydration.hydrating > 0;
  const hydrationFailed =
    !hasMore &&
    !!bodyHydration &&
    bodyHydration.total > 0 &&
    bodyHydration.error > 0 &&
    bodyHydration.pending + bodyHydration.hydrating === 0;
  if (!status && !hydrating && !hydrationFailed) return null;
  const detail =
    fetchedCount === null
      ? (hydrating || hydrationFailed) && bodyHydration
        ? dbText(
            hydrationFailed
              ? "builderBodiesSyncFinishedWithFailures"
              : "builderBodiesSyncingProgress",
            {
              hydrated: hydratedCount,
              total: bodyHydration.total,
              failed: bodyHydration.error,
            },
          )
        : null
      : (hydrating || hydrationFailed) && bodyHydration
        ? dbText(
            hydrationFailed
              ? "builderRowsFetchedBodiesSyncFinishedWithFailures"
              : "builderRowsFetchedBodiesSyncing",
            {
              rows: fetchedCount,
              hydrated: hydratedCount,
              total: bodyHydration.total,
              failed: bodyHydration.error,
            },
          )
        : dbText("builderRowsFetchedSoFar", {
            count: fetchedCountDetail ?? fetchedCount,
          });
  if (status === "error" || hydrationFailed) {
    return { failed: true as const, detail };
  }
  const label = hydrating
    ? dbText("builderRowsFetchedSyncingBodies")
    : hasMore
      ? dbText("builderRowsLoadingBackground")
      : dbText("builderRowsFinishingUp");
  return {
    failed: false as const,
    label: detail ? `${label} ${detail}` : label,
    percent: hydrating
      ? Math.round((hydratedCount / bodyHydration!.total) * 100)
      : builderSourceContinuationProgressPercent(source),
  };
}

/**
 * The status line of a collection a Builder model fills or adds details to:
 * which model, when it last updated, how far rows and bodies have got, and a
 * Retry when loading them failed.
 */
export function BuilderSourceStatusLine({
  source,
  documentId,
  canEdit,
  pageCount,
  pending,
  clientError,
  progressHighWater,
  onSyncNow,
  onRetry,
  onOpenSource,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  /** A sync of this source is under way. */
  pending: boolean;
  /** The last continuation this tab ran failed. */
  clientError: boolean;
  progressHighWater?: BuilderSourceProgressHighWater | undefined;
  onSyncNow: () => void;
  onRetry: () => void;
  onOpenSource?: (() => void) | undefined;
  onUnlinked?: (() => void) | undefined;
}) {
  const now = useNow();
  const addsDetails = source.metadata.federation?.role === "secondary";
  // Details come in with the rows they join, so only items show progress.
  const progress = addsDetails
    ? null
    : builderProgress(source, clientError, progressHighWater);
  const failed =
    progress?.failed === true ||
    source.syncState === "error" ||
    Boolean(source.lastError);
  const failedDetail = progress?.failed ? progress.detail : null;

  return (
    <SourceStatusLine
      provider="builder"
      icon={<BuilderLogoMark className="me-1.5 size-3.5 shrink-0" />}
      from={
        <SentenceWithName
          name={source.sourceName}
          sentence={(mark) =>
            dbText(
              addsDetails
                ? "sourceDetailsFromBuilderModel"
                : "sourceFromBuilderModel",
              { name: mark },
            )
          }
        />
      }
      onOpenSource={onOpenSource}
      updated={failed ? null : sourceUpdatedText(source.lastRefreshedAt, now)}
      facts={
        <SourceFacts
          rows={[
            { label: dbText("sourceDetailModel"), value: source.sourceTable },
            {
              label: dbText("sourceDetailUpdated"),
              value: source.lastRefreshedAt
                ? sourceRelativeTime(source.lastRefreshedAt, now)
                : dbText("sourceNotUpdatedYet"),
            },
          ]}
        />
      }
      sync={canEdit ? { pending, run: onSyncNow } : null}
      unlink={
        canEdit
          ? {
              provider: "builder",
              documentId,
              sourceId: source.id,
              pageCount,
              onUnlinked,
            }
          : null
      }
      problem={
        failed
          ? {
              text: [
                dbText("sourceProblemBuilder"),
                failedDetail,
                source.lastRefreshedAt
                  ? dbText("sourceShowingPagesAsOf", {
                      time: sourceRelativeTime(source.lastRefreshedAt, now),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" "),
              actions: canEdit ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={progress?.failed ? onRetry : onSyncNow}
                >
                  {dbText("retry")}
                </Button>
              ) : null,
            }
          : null
      }
      progress={
        progress && !progress.failed
          ? { label: progress.label, percent: progress.percent }
          : null
      }
    />
  );
}
