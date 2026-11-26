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

export function builderProgress(
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
      ? hydrating || hydrationFailed
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
      : hydrating || hydrationFailed
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
    return {
      failed: true as const,
      retry: status === "error" ? ("rows" as const) : ("content" as const),
      detail,
    };
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
      ? Math.round((hydratedCount / bodyHydration.total) * 100)
      : builderSourceContinuationProgressPercent(source),
    content: hydrating
      ? { done: hydratedCount, total: bodyHydration.total }
      : null,
  };
}

export function builderSourceProblem(
  source: ContentDatabaseSource,
  progress: ReturnType<typeof builderProgress>,
  now: number,
) {
  const failed =
    progress?.failed === true ||
    source.syncState === "error" ||
    Boolean(source.lastError);
  if (!failed) return null;
  return [
    dbText("sourceProblemBuilder"),
    progress?.failed ? progress.detail : null,
    source.lastRefreshedAt
      ? dbText("sourceShowingPagesAsOf", {
          time: sourceRelativeTime(source.lastRefreshedAt, now),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

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
  onRetryContent,
  retryContentPending = false,
  onOpenSource,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  pending: boolean;
  clientError: boolean;
  progressHighWater?: BuilderSourceProgressHighWater | undefined;
  onSyncNow: () => void;
  onRetry: () => void;
  onRetryContent?: (() => void) | undefined;
  retryContentPending?: boolean;
  onOpenSource?: (() => void) | undefined;
  onUnlinked?: (() => void) | undefined;
}) {
  const now = useNow();
  const addsDetails = source.metadata.federation?.role === "secondary";
  const progress = addsDetails
    ? null
    : builderProgress(source, clientError, progressHighWater);
  const problem = builderSourceProblem(source, progress, now);
  const retryContent = progress?.failed && progress.retry === "content";
  const retry = retryContent
    ? onRetryContent
    : progress?.failed
      ? onRetry
      : onSyncNow;

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
      updated={problem ? null : sourceUpdatedText(source.lastRefreshedAt, now)}
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
        problem
          ? {
              text: problem,
              actions:
                canEdit && retry ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={retryContent ? retryContentPending : pending}
                    onClick={retry}
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
