import { useT } from "@agent-native/core/client/i18n";
import {
  AI_FILTER_LABEL,
  AI_FILTER_MIN_LEARNED_EXAMPLES,
  AI_FILTER_RULE_NAME,
  type AiFilterTarget,
} from "@shared/ai-filter";
import type { AiFilterBackfillStatus } from "@shared/ai-filter-backfill";
import { IconFilter, IconInbox, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAccountFilter } from "@/hooks/use-account-filter";
import {
  useAiFilterBackfillStatus,
  useManageAiFilter,
  useManageAiFilterBackfill,
  useRefineAiFilter,
} from "@/hooks/use-ai-filter";
import { useAutomations } from "@/hooks/use-automations";
import { useLabels } from "@/hooks/use-emails";
import { labelTabHref } from "@/lib/inbox-tabs";
import { cn, truncate } from "@/lib/utils";

export type AiFilterDialogTarget = AiFilterTarget & { snippet?: string };

export function AiFilterDialog({
  open,
  onOpenChange,
  action,
  targets,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "filter" | "keep";
  targets: AiFilterDialogTarget[];
  onComplete?: () => void;
}) {
  const t = useT();
  const manageAiFilter = useManageAiFilter();
  const manageBackfill = useManageAiFilterBackfill();
  const refineAiFilter = useRefineAiFilter();
  const { refetch: refetchAutomations } = useAutomations({ enabled: open });
  const { activeAccounts } = useAccountFilter();
  const { data: labels = [] } = useLabels(
    activeAccounts.size > 0 ? [...activeAccounts] : undefined,
  );
  const labelNames = useMemo(
    () => new Map(labels.map((label) => [label.id, label.name])),
    [labels],
  );
  const [comment, setComment] = useState("");
  const [backfillRunId, setBackfillRunId] = useState<string | null>(null);
  const [backfillFailed, setBackfillFailed] = useState(false);
  const [awaitingExamples, setAwaitingExamples] = useState(false);
  const [learnedExampleCount, setLearnedExampleCount] = useState<number | null>(
    null,
  );
  const [correctionFailed, setCorrectionFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const backfillStatus = useAiFilterBackfillStatus(backfillRunId);
  const isFilter = action === "filter";
  const targetKey = targets.map((target) => target.id).join("\u0000");

  const previews = useMemo(() => {
    const byId = new Map<
      string,
      AiFilterBackfillStatus["perRule"][number]["previews"][number]
    >();
    for (const preview of (backfillStatus.data?.perRule ?? []).flatMap(
      (rule) => rule.previews,
    )) {
      byId.set(preview.id, preview);
    }
    return [...byId.values()].slice(0, 5);
  }, [backfillStatus.data?.perRule]);

  useEffect(() => {
    if (!open) return;
    setComment("");
    setBackfillRunId(null);
    setBackfillFailed(false);
    setAwaitingExamples(false);
    setLearnedExampleCount(null);
    setCorrectionFailed(false);
    setSubmitted(false);
  }, [open, action, targetKey]);

  const isPending =
    manageAiFilter.isPending ||
    refineAiFilter.isPending ||
    manageBackfill.isPending;

  const handleSubmit = async () => {
    if (targets.length === 0 || isPending) return;
    const note = comment.trim();
    try {
      await manageAiFilter.mutateAsync({
        mode: action,
        targets: targets.map(
          ({ id, threadId, accountEmail, sender, subject }) => ({
            id,
            threadId,
            accountEmail,
            sender,
            subject,
          }),
        ),
        ...(note ? { comment: note } : {}),
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.actionFailed"),
      );
      return;
    }

    let learnedRuleId: string;
    try {
      const { data: rules = [] } = await refetchAutomations();
      const learnedRule = rules.find(
        (rule) =>
          rule.domain === "mail" &&
          rule.kind === "ai-filter" &&
          rule.name === AI_FILTER_RULE_NAME,
      );
      if (!learnedRule) throw new Error("AI filter rule unavailable");
      learnedRuleId = learnedRule.id;
      const result = await refineAiFilter.mutateAsync({
        ruleId: learnedRuleId,
        corrections: targets.map((target) => ({
          emailId: target.id,
          sender: target.sender ?? "",
          subject: target.subject ?? "",
          snippet: target.snippet ?? "",
          expectedMatch: isFilter,
        })),
        ...(note ? { comment: note } : {}),
      });
      const waitingForExamples =
        result.backfillStatus === "waiting-for-examples";
      setBackfillRunId(result.backfillRunId ?? null);
      setAwaitingExamples(waitingForExamples);
      setLearnedExampleCount(
        waitingForExamples ? result.learnedExampleCount : null,
      );
      setBackfillFailed(
        result.backfillStatus !== "queued" && !waitingForExamples,
      );
    } catch {
      setSubmitted(true);
      setCorrectionFailed(true);
      return;
    }

    setSubmitted(true);
    toast(
      isFilter
        ? t("mail.aiFilter.filteredToast", { count: targets.length })
        : t("mail.aiFilter.keptToast", { count: targets.length }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFilter ? (
              <IconFilter className="size-4 text-primary" />
            ) : (
              <IconInbox className="size-4 text-primary" />
            )}
            {isFilter
              ? t("mail.aiFilter.filterTitle")
              : t("mail.aiFilter.keepTitle")}
          </DialogTitle>
          <DialogDescription>
            {isFilter
              ? t("mail.aiFilter.filterDescription", {
                  count: targets.length,
                })
              : t("mail.aiFilter.keepDescription", {
                  count: targets.length,
                })}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="space-y-3 py-2" aria-live="polite">
            {correctionFailed ? (
              <p role="alert" className="text-sm text-destructive">
                {t("mail.aiFilter.actionFailed")}
              </p>
            ) : awaitingExamples && learnedExampleCount !== null ? (
              <p className="text-sm text-muted-foreground">
                {t("mail.aiFilter.learningProgress", {
                  count: learnedExampleCount,
                  required: AI_FILTER_MIN_LEARNED_EXAMPLES,
                })}
              </p>
            ) : backfillFailed || backfillStatus.data?.status === "failed" ? (
              <p role="alert" className="text-sm text-destructive">
                {t("mail.sort.aiSetupSortingFailed")}
              </p>
            ) : backfillStatus.data?.status === "undone" ? (
              <p className="text-sm text-muted-foreground">
                {t("mail.sort.aiSetupUndoComplete", {
                  count: backfillStatus.data.restoredThreads ?? 0,
                })}
              </p>
            ) : backfillRunId === null ||
              !backfillStatus.data ||
              backfillStatus.isLoading ||
              backfillStatus.data?.status === "queued" ||
              backfillStatus.data?.status === "running" ||
              backfillStatus.data?.status === "undoing" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                <span>
                  {t("mail.sort.aiSetupSortingProgress", {
                    processed: backfillStatus.data?.processedThreads ?? 0,
                    total: backfillStatus.data?.totalThreads ?? 0,
                  })}
                </span>
              </div>
            ) : backfillStatus.data ? (
              <div className="space-y-2">
                {backfillStatus.data.perRule.map((rule) => (
                  <div
                    key={rule.ruleId}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {rule.name}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {t("mail.sort.aiSetupRuleCount", {
                        count: rule.matchedCount,
                      })}
                    </span>
                  </div>
                ))}
                {previews.length > 0 ? (
                  <ul className="max-h-52 space-y-2 overflow-y-auto">
                    {previews.map((preview) => (
                      <li
                        key={preview.id}
                        className="rounded-md border border-border/60 bg-card px-3 py-2"
                      >
                        <p className="truncate text-sm font-medium">
                          {preview.subject || t("mail.aiFilter.noSubject")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {preview.from || t("mail.aiFilter.unknownSender")}
                        </p>
                        {preview.labels.length > 0 || preview.archived ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {preview.labels.map((labelId) => {
                              const labelName =
                                labelNames.get(labelId) ??
                                labelId
                                  .replace(/^label:/, "")
                                  .replace(/^CATEGORY_/, "");
                              const displayName = labelName
                                .slice(labelName.lastIndexOf("/") + 1)
                                .replace(/_/g, " ")
                                .toLowerCase();
                              return (
                                <span
                                  key={labelId}
                                  className={cn(
                                    "label-badge",
                                    "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {truncate(displayName, 16)}
                                </span>
                              );
                            })}
                            {preview.archived ? (
                              <span className="label-badge bg-muted text-muted-foreground">
                                {t("mail.actions.archive")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link
                  to={labelTabHref(AI_FILTER_LABEL)}
                  onClick={() => onOpenChange(false)}
                >
                  {t("mail.aiFilter.reviewLabel")}
                </Link>
              </Button>
              {backfillStatus.data?.undoToken ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const status = backfillStatus.data;
                    if (!status?.undoToken) return;
                    try {
                      await manageBackfill.mutateAsync({
                        operation: "undo",
                        runId: status.runId,
                        undoToken: status.undoToken,
                      });
                      await backfillStatus.refetch();
                    } catch {
                      toast.error(t("mail.aiFilter.actionFailed"));
                    }
                  }}
                  disabled={
                    isPending ||
                    backfillStatus.data.status === "undoing" ||
                    backfillStatus.data.status === "undone"
                  }
                >
                  {backfillStatus.data.status === "undoing" && (
                    <IconLoader2 className="size-4 animate-spin" />
                  )}
                  {t("mail.actions.undo")}
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  onComplete?.();
                  onOpenChange(false);
                }}
              >
                {t("mail.sort.aiSetupDone")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p>{t("mail.aiFilter.labelHelp")}</p>
              <p>
                {isFilter
                  ? t("mail.aiFilter.labelNote")
                  : t("mail.aiFilter.learningNote")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ai-filter-comment" className="sr-only">
                {isFilter
                  ? t("mail.aiFilter.rememberLabel")
                  : t("mail.aiFilter.correctLabel")}
              </label>
              <Textarea
                id="ai-filter-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={
                  isFilter
                    ? t("mail.aiFilter.rememberPlaceholder")
                    : t("mail.aiFilter.correctPlaceholder")
                }
                rows={2}
                className="resize-none text-sm"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                {t("mail.aiFilter.commentHint")}
              </p>
            </div>
          </div>
        )}

        {!submitted && (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("settings.cancel")}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={targets.length === 0 || isPending}
            >
              {isPending && <IconLoader2 className="size-4 animate-spin" />}
              {isFilter
                ? t("mail.aiFilter.filterButton")
                : t("mail.aiFilter.keepButton")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
