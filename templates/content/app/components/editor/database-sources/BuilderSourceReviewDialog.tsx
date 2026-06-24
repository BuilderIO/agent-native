import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "@shared/api";
import type {
  BuilderCmsPublicationTransitionIntent,
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceWriteMode,
  DocumentPropertyValue,
  ExecuteBuilderSourceBatchTransition,
  ExecuteBuilderSourceBatchResponse,
} from "@shared/api";

export type BuilderReviewPublicationTransitionSelection = {
  publicationTransition: BuilderCmsPublicationTransitionIntent;
  confirmUnpublish?: boolean;
};

export type BuilderReviewPublicationTransitionSelections = Record<
  string,
  BuilderReviewPublicationTransitionSelection
>;

export type BuilderReviewPublicationTransitions = Record<
  string,
  ExecuteBuilderSourceBatchTransition
>;

export function builderReviewDefaultPublicationEffectLabel(
  writeMode?: ContentDatabaseSourceWriteMode,
) {
  if (writeMode === "stage_only") return "Stage autosave";
  if (writeMode === "publish_updates") {
    return "Update in place (keeps current published/draft state)";
  }
  return "Check only";
}

export function builderReviewPublicationIntentSummary(
  changeSetIds: string[],
  selections: BuilderReviewPublicationTransitionSelections,
  writeMode?: ContentDatabaseSourceWriteMode,
) {
  const publish = changeSetIds.filter(
    (changeSetId) =>
      selections[changeSetId]?.publicationTransition === "publish",
  ).length;
  const unpublish = changeSetIds.filter(
    (changeSetId) =>
      selections[changeSetId]?.publicationTransition === "unpublish",
  ).length;
  const defaultAction = Math.max(changeSetIds.length - publish - unpublish, 0);
  const defaultLabel =
    writeMode === "stage_only" ? "stage autosave" : "update in place";

  return `${defaultAction} ${defaultLabel} · ${publish} publish · ${unpublish} unpublish`;
}

export function builderReviewPublicationTransitionsMap(
  selections: BuilderReviewPublicationTransitionSelections,
) {
  const transitions: BuilderReviewPublicationTransitions = {};

  for (const [changeSetId, selection] of Object.entries(selections)) {
    if (selection.publicationTransition === "publish") {
      transitions[changeSetId] = { publicationTransition: "publish" };
      continue;
    }

    if (
      selection.publicationTransition === "unpublish" &&
      selection.confirmUnpublish === true
    ) {
      transitions[changeSetId] = {
        publicationTransition: "unpublish",
        confirmUnpublish: true,
      };
    }
  }

  return transitions;
}

function sourceRiskClass(risk: ContentDatabaseSourceChangeSet["riskLevel"]) {
  if (risk === "high") {
    return "rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive";
  }
  if (risk === "medium") {
    return "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700";
  }
  return "rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-700";
}

function sourceValueText(value: DocumentPropertyValue) {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sourceBuilderReadModeSummary(source: ContentDatabaseSource) {
  if (source.metadata.readMode === "builder-api")
    return "Builder API read-only";
  if (source.metadata.readMode === "local-fixture") return "Local fixture";
  if (source.metadata.readMode === "unconfigured") return "Not configured";
  if (source.metadata.readMode === "error") return "Read error";
  return "Local review";
}

function sourcePushModeLabel(
  mode: ContentDatabaseSource["metadata"]["pushMode"],
) {
  if (mode === "autosave") return "Save revision / autosave";
  if (mode === "draft") return "Draft";
  if (mode === "publish") return "Publish";
  return "None";
}

function SourceMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{value}</span>
    </div>
  );
}

export function BuilderSourceReviewDialog({
  open,
  review,
  source,
  canEdit,
  pending,
  batchResult,
  checkedAt,
  onClose,
  onValidate,
}: {
  open: boolean;
  review: ContentDatabaseSourceReviewPayload | null;
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  batchResult: ExecuteBuilderSourceBatchResponse | null;
  checkedAt: string | null;
  onClose: () => void;
  onValidate: (transitions: BuilderReviewPublicationTransitions) => void;
}) {
  const checked = !!checkedAt;
  const safeModel =
    source?.sourceType === "builder-cms" &&
    source.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL;
  const writeMode = source?.metadata.writeMode;
  const defaultEffectLabel =
    builderReviewDefaultPublicationEffectLabel(writeMode);
  const allowPublicationTransitionControls =
    safeModel &&
    writeMode === "publish_updates" &&
    source?.metadata.allowPublicationTransitions === true;
  const reviewRowIds = useMemo(
    () => review?.rows.map((row) => row.changeSetId) ?? [],
    [review],
  );
  const reviewRowIdsKey = reviewRowIds.join("\u0000");
  const [transitionSelections, setTransitionSelections] =
    useState<BuilderReviewPublicationTransitionSelections>({});
  useEffect(() => {
    if (!open || !allowPublicationTransitionControls) {
      setTransitionSelections({});
      return;
    }

    const reviewRowIdSet = new Set(
      reviewRowIdsKey ? reviewRowIdsKey.split("\u0000") : [],
    );
    setTransitionSelections((current) => {
      const next: BuilderReviewPublicationTransitionSelections = {};
      for (const [changeSetId, selection] of Object.entries(current)) {
        if (reviewRowIdSet.has(changeSetId)) next[changeSetId] = selection;
      }
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [allowPublicationTransitionControls, open, reviewRowIdsKey]);
  const transitionMap = useMemo(
    () => builderReviewPublicationTransitionsMap(transitionSelections),
    [transitionSelections],
  );
  const intentSummary = builderReviewPublicationIntentSummary(
    reviewRowIds,
    transitionSelections,
    writeMode,
  );
  const hasUnconfirmedUnpublish = Object.values(transitionSelections).some(
    (selection) =>
      selection.publicationTransition === "unpublish" &&
      selection.confirmUnpublish !== true,
  );
  const batchHasIssues =
    !!batchResult &&
    (batchResult.summary.blocked > 0 || batchResult.summary.failed > 0);
  const retryable =
    review?.result.status === "failed" ||
    review?.result.status === "blocked" ||
    review?.result.status === "stale" ||
    batchHasIssues;
  const unsafeLiveTarget = review?.liveWritesEnabled === true && !safeModel;
  const disabled =
    !canEdit ||
    pending ||
    (!retryable && checked) ||
    !review ||
    review.rows.length === 0 ||
    unsafeLiveTarget ||
    hasUnconfirmedUnpublish;
  const rowTitleById = new Map(
    review?.rows.map((row) => [row.changeSetId, row.title]) ?? [],
  );
  const batchIssueResults =
    batchResult?.results.filter((result) => result.status !== "succeeded") ??
    [];
  const batchSummaryText = batchResult
    ? `${batchResult.summary.succeeded} succeeded, ${batchResult.summary.blocked} blocked, ${batchResult.summary.failed} failed.`
    : null;
  const resultMessage = batchSummaryText ?? review?.result.message;
  const resultStatus = batchResult
    ? batchHasIssues
      ? "partial"
      : "succeeded"
    : review?.result.status;
  const footerText = pending
    ? review?.liveWritesEnabled
      ? "Preparing the Builder gate and sending through the guarded write path."
      : "Checking the Builder gate locally."
    : hasUnconfirmedUnpublish
      ? "Confirm unpublish on selected rows before pushing."
      : unsafeLiveTarget
        ? `Live batch pushes are limited to ${BUILDER_CMS_SAFE_WRITE_MODEL}.`
        : checked
          ? review?.result.status === "succeeded"
            ? "Pushed to Builder and reconciled locally."
            : batchResult
              ? batchSummaryText
              : review?.liveWritesEnabled
                ? (review?.result.message ?? "Builder push finished.")
                : "Checked just now. Nothing was sent to Builder."
          : review?.liveWritesEnabled
            ? "Push will send approved writes through the guarded Builder path."
            : "Builder writes are disabled. Push will check the update only.";
  const buttonLabel = pending
    ? review?.liveWritesEnabled
      ? "Pushing..."
      : "Checking..."
    : checked && batchResult
      ? batchHasIssues
        ? "Retry"
        : "Pushed"
      : checked && review?.result.status === "succeeded"
        ? "Pushed"
        : checked && !retryable
          ? "Checked"
          : review?.liveWritesEnabled && (review?.rows.length ?? 0) > 1
            ? `Push all approved (${review?.rows.length ?? 0})`
            : "Push";

  function setRowPublicationTransition(
    changeSetId: string,
    publicationTransition: BuilderCmsPublicationTransitionIntent,
  ) {
    setTransitionSelections((current) => {
      const currentSelection = current[changeSetId];
      const next = { ...current };

      if (currentSelection?.publicationTransition === publicationTransition) {
        delete next[changeSetId];
        return next;
      }

      next[changeSetId] = {
        publicationTransition,
        confirmUnpublish:
          publicationTransition === "unpublish" ? false : undefined,
      };
      return next;
    });
  }

  function setRowConfirmUnpublish(changeSetId: string, confirmed: boolean) {
    setTransitionSelections((current) => {
      const currentSelection = current[changeSetId];
      if (currentSelection?.publicationTransition !== "unpublish") {
        return current;
      }
      return {
        ...current,
        [changeSetId]: {
          publicationTransition: "unpublish",
          confirmUnpublish: confirmed,
        },
      };
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        hideClose
        className="flex max-h-[calc(100vh-6rem)] w-[calc(100vw-1.5rem)] max-w-3xl min-w-0 flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <DialogTitle
              id="builder-source-review-title"
              className="truncate text-sm font-semibold"
            >
              Review Builder update
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {review?.summary ?? "No pending Builder changes."}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close Builder update review"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
          >
            <IconX className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {review ? (
            <div className="grid gap-4">
              <section className="grid gap-2">
                <div className="text-sm font-medium">What changed</div>
                <div className="grid gap-2">
                  {review.rows.map((row) => (
                    <div
                      key={row.changeSetId}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {row.title}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.fieldChanges.length} field change
                            {row.fieldChanges.length === 1 ? "" : "s"}
                            {row.bodyChange ? " plus body diff" : ""}
                          </div>
                        </div>
                        <span className={sourceRiskClass(row.riskLevel)}>
                          {row.riskLevel} risk
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {safeModel ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-muted-foreground">
                              {defaultEffectLabel}
                            </span>
                            {allowPublicationTransitionControls ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    transitionSelections[row.changeSetId]
                                      ?.publicationTransition === "publish"
                                      ? "secondary"
                                      : "outline"
                                  }
                                  className="h-7 px-2 text-xs"
                                  disabled={pending}
                                  aria-pressed={
                                    transitionSelections[row.changeSetId]
                                      ?.publicationTransition === "publish"
                                  }
                                  onClick={() =>
                                    setRowPublicationTransition(
                                      row.changeSetId,
                                      "publish",
                                    )
                                  }
                                >
                                  Publish
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    transitionSelections[row.changeSetId]
                                      ?.publicationTransition === "unpublish"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  className="h-7 px-2 text-xs"
                                  disabled={pending}
                                  aria-pressed={
                                    transitionSelections[row.changeSetId]
                                      ?.publicationTransition === "unpublish"
                                  }
                                  onClick={() =>
                                    setRowPublicationTransition(
                                      row.changeSetId,
                                      "unpublish",
                                    )
                                  }
                                >
                                  Unpublish
                                </Button>
                                {transitionSelections[row.changeSetId]
                                  ?.publicationTransition === "unpublish" ? (
                                  <label className="flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
                                    <input
                                      type="checkbox"
                                      className="size-3 accent-destructive"
                                      checked={
                                        transitionSelections[row.changeSetId]
                                          ?.confirmUnpublish === true
                                      }
                                      disabled={pending}
                                      onChange={(event) =>
                                        setRowConfirmUnpublish(
                                          row.changeSetId,
                                          event.currentTarget.checked,
                                        )
                                      }
                                    />
                                    Confirm unpublish
                                  </label>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {row.fieldChanges.map((field) => (
                          <div
                            key={`${row.changeSetId}-${field.localFieldKey}`}
                            className="grid gap-1 rounded border border-border/70 bg-muted/20 p-2 text-xs"
                          >
                            <div className="font-medium">
                              {field.propertyName ?? field.sourceFieldKey}
                            </div>
                            <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                              <div className="min-w-0 break-words">
                                From: {sourceValueText(field.currentValue)}
                              </div>
                              <div className="min-w-0 break-words">
                                To: {sourceValueText(field.proposedValue)}
                              </div>
                            </div>
                          </div>
                        ))}
                        {row.bodyChange ? (
                          <div className="rounded border border-border/70 bg-muted/20 p-2 text-xs">
                            <div className="font-medium">
                              {row.bodyChange.summary}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              Builder body edits need a safer push path before
                              they can be sent.
                            </div>
                          </div>
                        ) : null}
                        {row.execution?.lastError ? (
                          <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                            {row.execution.lastError}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid gap-2 rounded-md border border-border p-3">
                <div className="text-sm font-medium">Where it will go</div>
                <div className="grid gap-2 text-xs">
                  <SourceMetadataRow label="Source" value={review.sourceName} />
                  <SourceMetadataRow
                    label="Builder model"
                    value={review.sourceTable}
                  />
                  <SourceMetadataRow
                    label="Push mode"
                    value={sourcePushModeLabel(review.pushMode)}
                  />
                  <SourceMetadataRow
                    label="Live writes"
                    value={review.liveWritesEnabled ? "enabled" : "disabled"}
                  />
                  <SourceMetadataRow
                    label="Read mode"
                    value={
                      source ? sourceBuilderReadModeSummary(source) : "unknown"
                    }
                  />
                </div>
              </section>

              <section className="grid gap-2 rounded-md border border-border p-3">
                <div className="text-sm font-medium">Risk check</div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className={sourceRiskClass(review.riskLevel)}>
                    {review.riskLevel} risk
                  </span>
                  {(review.riskReasons.length
                    ? review.riskReasons
                    : ["single field diff"]
                  ).map((reason) => (
                    <span
                      key={reason}
                      className="rounded border border-border px-1.5 py-0.5 text-muted-foreground"
                    >
                      {reason}
                    </span>
                  ))}
                  <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                    {review.dryRunOnly ? "checks only" : "can send to Builder"}
                  </span>
                </div>
              </section>

              <section className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Result</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {resultMessage}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {resultStatus?.replace(/_/g, " ")}
                  </span>
                </div>
                {batchResult ? (
                  <div className="grid gap-2 border-t border-border pt-3 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                        {batchResult.summary.succeeded} succeeded
                      </span>
                      <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700">
                        {batchResult.summary.blocked} blocked
                      </span>
                      <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                        {batchResult.summary.failed} failed
                      </span>
                    </div>
                    {batchIssueResults.length > 0 ? (
                      <div className="grid gap-1.5">
                        {batchIssueResults.map((result) => (
                          <div
                            key={result.changeSetId}
                            className="rounded border border-border/70 bg-muted/20 p-2"
                          >
                            <div className="font-medium">
                              {rowTitleById.get(result.changeSetId) ??
                                result.changeSetId}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {result.status}:{" "}
                              {result.message ?? "No details returned."}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          ) : (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No pending local Builder changes yet.
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3">
          <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            {safeModel && review ? (
              <div className="font-medium text-foreground">{intentSummary}</div>
            ) : null}
            <div>{footerText}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => onValidate(transitionMap)}
            >
              {pending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : checked ? (
                <IconCheck className="mr-1.5 size-3.5" />
              ) : null}
              {buttonLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
