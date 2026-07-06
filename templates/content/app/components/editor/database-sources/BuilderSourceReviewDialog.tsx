import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "@shared/api";
import type {
  BuilderCmsPublicationTransitionIntent,
  BuilderCmsWriteEffect,
  ContentDatabaseSource,
  ContentDatabaseSourceReviewPayload,
  DocumentPropertyValue,
  ExecuteBuilderSourceBatchTransition,
  ExecuteBuilderSourceBatchResponse,
} from "@shared/api";
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

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

const EFFECT_LABELS: Record<
  BuilderCmsWriteEffect,
  { tag: string; sentence: string }
> = {
  create_draft: { tag: "New", sentence: "Creates a new draft entry" },
  update_in_place: { tag: "Edit", sentence: "Updates the live entry" },
  autosave: { tag: "Draft", sentence: "Saves a draft revision" },
  publish: { tag: "Publish", sentence: "Publishes this entry" },
  unpublish: { tag: "Unpublish", sentence: "Unpublishes the live entry" },
};

export function builderReviewRowEffectLabel(effect: BuilderCmsWriteEffect) {
  return EFFECT_LABELS[effect] ?? EFFECT_LABELS.update_in_place;
}

/** The effect a row will actually run, accounting for a chosen transition. */
export function builderReviewEffectiveRowEffect(
  baseEffect: BuilderCmsWriteEffect,
  selection?: BuilderReviewPublicationTransitionSelection,
): BuilderCmsWriteEffect {
  // A create has no Builder entry yet, so a publish/unpublish transition can't
  // apply — the adapter always writes a draft (create_draft) when there's no
  // entry id. Never let a transition relabel a create.
  if (baseEffect === "create_draft") return "create_draft";
  if (selection?.publicationTransition === "publish") return "publish";
  if (selection?.publicationTransition === "unpublish") return "unpublish";
  return baseEffect;
}

export function builderReviewIntentSummary(
  rows: { changeSetId: string; effect: BuilderCmsWriteEffect }[],
  selections: BuilderReviewPublicationTransitionSelections,
) {
  const counts: Record<BuilderCmsWriteEffect, number> = {
    create_draft: 0,
    update_in_place: 0,
    autosave: 0,
    publish: 0,
    unpublish: 0,
  };
  for (const row of rows) {
    counts[
      builderReviewEffectiveRowEffect(row.effect, selections[row.changeSetId])
    ] += 1;
  }
  const parts: string[] = [];
  if (counts.create_draft) {
    parts.push(
      `${counts.create_draft} draft${counts.create_draft === 1 ? "" : "s"} to create`,
    );
  }
  if (counts.update_in_place) {
    parts.push(
      `${counts.update_in_place} update${counts.update_in_place === 1 ? "" : "s"}`,
    );
  }
  if (counts.autosave) {
    parts.push(
      `${counts.autosave} draft save${counts.autosave === 1 ? "" : "s"}`,
    );
  }
  if (counts.publish) parts.push(`${counts.publish} to publish`);
  if (counts.unpublish) parts.push(`${counts.unpublish} to unpublish`);
  return parts.join(" · ") || "No changes";
}

export function builderReviewDestinationLine(args: {
  rows: { changeSetId: string; effect: BuilderCmsWriteEffect }[];
  selections: BuilderReviewPublicationTransitionSelections;
  liveWritesEnabled: boolean;
}) {
  if (!args.liveWritesEnabled) {
    return "Checks the update only — nothing is sent to Builder.";
  }
  const effects = new Set(
    args.rows.map((row) =>
      builderReviewEffectiveRowEffect(
        row.effect,
        args.selections[row.changeSetId],
      ),
    ),
  );
  if (effects.has("unpublish")) {
    return "Unpublishes selected entries in Builder.";
  }
  if (effects.has("publish")) {
    return "Publishes selected entries in Builder.";
  }
  if (effects.size === 1 && effects.has("create_draft")) {
    return args.rows.length === 1
      ? "Writes a new draft to Builder — won't publish."
      : "Writes new drafts to Builder — nothing is published.";
  }
  return "Updates content in Builder — publication state is preserved.";
}

export function builderReviewResultStatus(status?: string): {
  // i18n key under the `database.` namespace; resolved by the caller via t().
  labelKey: string;
  tone: "ok" | "warn" | "danger" | "muted";
} {
  switch (status) {
    case "succeeded":
      return { labelKey: "pushed", tone: "ok" };
    case "validated":
      return { labelKey: "ready", tone: "ok" };
    case "partial":
    case "blocked":
      return { labelKey: "needsAttention", tone: "warn" };
    case "failed":
      return { labelKey: "failedYouCanRetry", tone: "danger" };
    case "stale":
      return { labelKey: "needsAFreshReview", tone: "warn" };
    case "running":
      return { labelKey: "working", tone: "muted" };
    case "write_disabled":
      return { labelKey: "checksOnly", tone: "muted" };
    default:
      return { labelKey: "ready", tone: "muted" };
  }
}

function resultToneClass(tone: "ok" | "warn" | "danger" | "muted") {
  if (tone === "ok") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "warn") return "text-amber-700 dark:text-amber-300";
  if (tone === "danger") return "text-destructive";
  return "text-muted-foreground";
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

const ATTENTION_TAG_EFFECTS: ReadonlySet<BuilderCmsWriteEffect> = new Set([
  "unpublish",
]);

function rowEffectTagClass(effect: BuilderCmsWriteEffect) {
  return ATTENTION_TAG_EFFECTS.has(effect)
    ? "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    : "rounded border border-border bg-muted/40 px-1.5 py-0.5 text-muted-foreground";
}

function sourceValueText(value: DocumentPropertyValue) {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function BuilderSourceReviewDialog({
  open,
  review,
  source,
  canEdit,
  pending,
  batchResult = null,
  checkedAt,
  onClose,
  onValidate,
}: {
  open: boolean;
  review: ContentDatabaseSourceReviewPayload | null;
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  // Optional so the inline-database caller (DatabaseView) that doesn't surface
  // batch results can still mount the dialog.
  batchResult?: ExecuteBuilderSourceBatchResponse | null;
  checkedAt: string | null;
  onClose: () => void;
  onValidate: (transitions: BuilderReviewPublicationTransitions) => void;
}) {
  const t = useT();
  const checked = !!checkedAt;
  const safeModel =
    source?.sourceType === "builder-cms" &&
    source.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL;
  const writeMode = source?.metadata.writeMode;
  const allowPublicationTransitionControls =
    safeModel &&
    writeMode === "publish_updates" &&
    source?.metadata.allowPublicationTransitions === true;
  const reviewRows = useMemo(() => review?.rows ?? [], [review]);
  const reviewRowIds = useMemo(
    () => reviewRows.map((row) => row.changeSetId),
    [reviewRows],
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
  const intentSummary = builderReviewIntentSummary(
    reviewRows,
    transitionSelections,
  );
  const destinationLine = builderReviewDestinationLine({
    rows: reviewRows,
    selections: transitionSelections,
    liveWritesEnabled: review?.liveWritesEnabled === true,
  });
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
    reviewRows.map((row) => [row.changeSetId, row.title]),
  );
  const batchIssueResults =
    batchResult?.results.filter((result) => result.status !== "succeeded") ??
    [];
  const resultStatus = builderReviewResultStatus(
    batchResult
      ? batchHasIssues
        ? "partial"
        : "succeeded"
      : review?.result.status,
  );
  const footerHint = pending
    ? review?.liveWritesEnabled
      ? "Sending to Builder…"
      : "Checking…"
    : hasUnconfirmedUnpublish
      ? "Confirm unpublish on the selected rows first."
      : unsafeLiveTarget
        ? `Live pushes are limited to the ${BUILDER_CMS_SAFE_WRITE_MODEL} test model.`
        : null;
  const effectiveEffects = new Set(
    reviewRows.map((row) =>
      builderReviewEffectiveRowEffect(
        row.effect,
        transitionSelections[row.changeSetId],
      ),
    ),
  );
  const pushVerb = !review?.liveWritesEnabled
    ? "Check"
    : effectiveEffects.has("unpublish")
      ? "Unpublish"
      : effectiveEffects.has("publish")
        ? "Publish"
        : effectiveEffects.size === 1 && effectiveEffects.has("create_draft")
          ? reviewRows.length > 1
            ? `Create ${reviewRows.length} drafts`
            : "Create draft"
          : reviewRows.length > 1
            ? `Push ${reviewRows.length} updates`
            : "Push update";
  const buttonLabel = pending
    ? review?.liveWritesEnabled
      ? "Working…"
      : "Checking…"
    : checked && batchResult
      ? batchHasIssues
        ? "Retry"
        : "Pushed"
      : checked && review?.result.status === "succeeded"
        ? "Pushed"
        : checked && !retryable
          ? "Checked"
          : pushVerb;

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
              {t("database.reviewBuilderUpdate")}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {review?.summary ?? "No pending Builder changes."}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label={t("database.closeBuilderUpdateReview")}
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
                <div className="text-sm font-medium">
                  {t("database.whatChanged")}
                </div>
                <div className="grid gap-2">
                  {reviewRows.map((row) => {
                    const selection = transitionSelections[row.changeSetId];
                    const effect = builderReviewEffectiveRowEffect(
                      row.effect,
                      selection,
                    );
                    const { tag, sentence } =
                      builderReviewRowEffectLabel(effect);
                    const showConflict =
                      effect !== "create_draft" &&
                      row.conflictState === "source_changed";
                    return (
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
                              {sentence}
                            </div>
                          </div>
                          <span
                            className={
                              "shrink-0 text-[11px] " +
                              rowEffectTagClass(effect)
                            }
                          >
                            {tag}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {allowPublicationTransitionControls &&
                          row.effect !== "create_draft" ? (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
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
                                  {t("database.confirmUnpublish")}
                                </label>
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
                              {row.bodyChange.warnings?.length ? (
                                <div className="mt-1 text-muted-foreground">
                                  {row.bodyChange.warnings.join(" ")}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {showConflict ? (
                            <div className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                              <span>
                                {t("database.changedInBuilderSinceSync")}
                              </span>
                            </div>
                          ) : null}
                          {effect === "unpublish" ? (
                            <div className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                              <span>
                                {t("database.thisUnpublishesTheLiveEntry")}
                              </span>
                            </div>
                          ) : null}
                          {row.execution?.lastError ? (
                            <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                              {row.execution.lastError}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <IconCloudUpload className="mt-0.5 size-3.5 shrink-0" />
                <span>{destinationLine}</span>
              </div>

              {batchResult && batchIssueResults.length > 0 ? (
                <section className="grid gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="font-medium">
                    {t("database.needsAttentionBeforeFinish")}
                  </div>
                  {batchIssueResults.map((result) => (
                    <div key={result.changeSetId} className="break-words">
                      <span className="font-medium">
                        {rowTitleById.get(result.changeSetId) ??
                          result.changeSetId}
                      </span>
                      {" — "}
                      {result.message ?? "No details returned."}
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              {t("database.noPendingLocalBuilderChanges")}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3">
          <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            {review ? (
              <div
                className={
                  "flex items-center gap-1.5 font-medium " +
                  resultToneClass(resultStatus.tone)
                }
              >
                {checked ? (
                  resultStatus.tone === "ok" ? (
                    <IconCheck className="size-3.5 shrink-0" />
                  ) : (
                    <IconAlertTriangle className="size-3.5 shrink-0" />
                  )
                ) : null}
                <span>
                  {checked
                    ? `${t(`database.${resultStatus.labelKey}`)} · ${intentSummary}`
                    : intentSummary}
                </span>
              </div>
            ) : null}
            {footerHint ? <div>{footerHint}</div> : null}
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
