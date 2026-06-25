import { useT } from "@agent-native/core/client";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceReviewPayload,
  DocumentPropertyValue,
} from "@shared/api";
import { IconCheck, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

function sourceRiskClass(risk: ContentDatabaseSourceChangeSet["riskLevel"]) {
  if (risk === "high") {
    return "rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive";
  }
  if (risk === "medium") {
    return "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700";
  }
  return "rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-700";
}

function sourceValueText(value: DocumentPropertyValue, emptyLabel: string) {
  if (value === null || value === undefined || value === "") return emptyLabel;
  if (Array.isArray(value)) return value.join(", ") || emptyLabel;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sourceBuilderReadModeSummary(
  source: ContentDatabaseSource,
  t: ReturnType<typeof useT>,
) {
  if (source.metadata.readMode === "builder-api")
    return t("database.builderApiReadOnly");
  if (source.metadata.readMode === "local-fixture")
    return t("database.localFixture");
  if (source.metadata.readMode === "unconfigured")
    return t("database.notConfigured");
  if (source.metadata.readMode === "error") return t("database.readError");
  return t("database.localReview");
}

function sourcePushModeLabel(
  mode: ContentDatabaseSource["metadata"]["pushMode"],
  t: ReturnType<typeof useT>,
) {
  if (mode === "autosave") return t("database.saveRevisionAutosave");
  if (mode === "draft") return t("database.draft");
  if (mode === "publish") return t("database.publish");
  return t("database.none");
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
  checkedAt,
  onClose,
  onValidate,
}: {
  open: boolean;
  review: ContentDatabaseSourceReviewPayload | null;
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  checkedAt: string | null;
  onClose: () => void;
  onValidate: () => void;
}) {
  const t = useT();
  const checked = !!checkedAt;
  const retryable =
    review?.result.status === "failed" ||
    review?.result.status === "blocked" ||
    review?.result.status === "stale";
  const disabled =
    !canEdit ||
    pending ||
    (!retryable && checked) ||
    !review ||
    review.rows.length === 0;
  const footerText = pending
    ? review?.liveWritesEnabled
      ? t("database.builderPreparingGate")
      : t("database.builderCheckingGate")
    : checked
      ? review?.result.status === "succeeded"
        ? t("database.builderPushedReconciled")
        : review?.liveWritesEnabled
          ? (review?.result.message ?? t("database.builderPushFinished"))
          : t("database.builderCheckedNothingSent")
      : review?.liveWritesEnabled
        ? t("database.builderPushWillSend")
        : t("database.builderWritesDisabledCheckOnly");
  const buttonLabel = pending
    ? review?.liveWritesEnabled
      ? t("database.pushing")
      : t("database.checking")
    : checked && review?.result.status === "succeeded"
      ? t("database.pushed")
      : checked && !retryable
        ? t("database.checked")
        : t("database.push");

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
              {review?.summary ?? t("database.noPendingBuilderChanges")}
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
                            {t("database.fieldChangeCount", {
                              count: row.fieldChanges.length,
                            })}
                            {row.bodyChange
                              ? ` ${t("database.plusBodyDiff")}`
                              : ""}
                          </div>
                        </div>
                        <span className={sourceRiskClass(row.riskLevel)}>
                          {t("database.riskLabel", { level: row.riskLevel })}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
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
                                {t("database.fromValue", {
                                  value: sourceValueText(
                                    field.currentValue,
                                    t("database.empty"),
                                  ),
                                })}
                              </div>
                              <div className="min-w-0 break-words">
                                {t("database.toValue", {
                                  value: sourceValueText(
                                    field.proposedValue,
                                    t("database.empty"),
                                  ),
                                })}
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
                              {t("database.builderBodyEditsNeedSaferPath")}
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
                <div className="text-sm font-medium">
                  {t("database.whereItWillGo")}
                </div>
                <div className="grid gap-2 text-xs">
                  <SourceMetadataRow
                    label={t("database.source")}
                    value={review.sourceName}
                  />
                  <SourceMetadataRow
                    label={t("database.builderModel")}
                    value={review.sourceTable}
                  />
                  <SourceMetadataRow
                    label={t("database.pushMode")}
                    value={sourcePushModeLabel(review.pushMode, t)}
                  />
                  <SourceMetadataRow
                    label={t("database.liveWrites")}
                    value={
                      review.liveWritesEnabled
                        ? t("database.enabled")
                        : t("database.disabled")
                    }
                  />
                  <SourceMetadataRow
                    label={t("database.readMode")}
                    value={
                      source
                        ? sourceBuilderReadModeSummary(source, t)
                        : t("database.unknown")
                    }
                  />
                </div>
              </section>

              <section className="grid gap-2 rounded-md border border-border p-3">
                <div className="text-sm font-medium">
                  {t("database.riskCheck")}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className={sourceRiskClass(review.riskLevel)}>
                    {t("database.riskLabel", { level: review.riskLevel })}
                  </span>
                  {(review.riskReasons.length
                    ? review.riskReasons
                    : [t("database.singleFieldDiff")]
                  ).map((reason) => (
                    <span
                      key={reason}
                      className="rounded border border-border px-1.5 py-0.5 text-muted-foreground"
                    >
                      {reason}
                    </span>
                  ))}
                  <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                    {review.dryRunOnly
                      ? t("database.checksOnly")
                      : t("database.canSendToBuilder")}
                  </span>
                </div>
              </section>

              <section className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      {t("database.result")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {review.result.message}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {review.result.status.replace(/_/g, " ")}
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              {t("database.noPendingLocalBuilderChangesYet")}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {footerText}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("database.close")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={onValidate}
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
