import { useT } from "@agent-native/core/client/i18n";
import type { AiFilterDecision, AiFilterTarget } from "@shared/ai-filter";
import { AI_FILTER_LABEL, AI_FILTER_RULE_NAME } from "@shared/ai-filter";
import type { AutomationRule } from "@shared/types";
import {
  IconArrowUpRight,
  IconLoader2,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { AiFilterDialog } from "@/components/email/AiFilterDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  latestAiFilterDecisions,
  useAiFilter,
  useManageAiFilter,
} from "@/hooks/use-ai-filter";
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/hooks/use-automations";
import { cn } from "@/lib/utils";

const THRESHOLD_OPTIONS = [0.85, 0.92, 0.97];

function decisionTarget(decision: AiFilterDecision): AiFilterTarget {
  return {
    id: decision.messageId,
    threadId: decision.threadId,
    accountEmail: decision.accountEmail,
    sender: decision.sender,
    subject: decision.subject,
  };
}

function formatDecisionDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function InstructionRow({ rule }: { rule: AutomationRule }) {
  const t = useT();
  const update = useUpdateAutomation();
  const remove = useDeleteAutomation();

  return (
    <div className="group flex items-start gap-3 border-b border-border/40 px-1 py-3 last:border-0">
      <Switch
        checked={rule.enabled}
        onCheckedChange={(enabled) => update.mutate({ id: rule.id, enabled })}
        className="mt-0.5 scale-90"
        aria-label={t("mail.aiFilter.toggleInstruction", {
          instruction: rule.condition,
        })}
      />
      <p
        className={cn(
          "min-w-0 flex-1 text-sm leading-5",
          rule.enabled ? "text-foreground" : "text-muted-foreground/50",
        )}
      >
        {rule.condition}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={() => remove.mutate(rule.id)}
            disabled={remove.isPending}
            aria-label={t("mail.aiFilter.deleteInstruction")}
          >
            {remove.isPending ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconTrash className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("mail.aiFilter.deleteInstruction")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function DecisionRow({
  decision,
  onReview,
}: {
  decision: AiFilterDecision;
  onReview: (action: "filter" | "keep", decision: AiFilterDecision) => void;
}) {
  const t = useT();
  const isSuggested = decision.disposition === "suggested";
  const isFiltered = decision.disposition === "filtered";

  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-1 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {decision.sender || t("mail.aiFilter.unknownSender")}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
            {formatDecisionDate(decision.createdAt)}
          </span>
        </div>
        <p className="truncate text-[12px] text-muted-foreground">
          {decision.subject || t("mail.aiFilter.noSubject")}
        </p>
        {decision.reason && (
          <p
            className="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground/70"
            title={decision.reason}
          >
            {decision.reason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isSuggested && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => onReview("keep", decision)}
            >
              {t("mail.aiFilter.keepButton")}
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => onReview("filter", decision)}
            >
              {t("mail.aiFilter.filterButton")}
            </Button>
          </>
        )}
        {isFiltered && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => onReview("keep", decision)}
          >
            {t("mail.aiFilter.keepButton")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AiFilterSection() {
  const t = useT();
  const { data: state, isLoading } = useAiFilter();
  const { data: rules = [] } = useAutomations();
  const createRule = useCreateAutomation();
  const manage = useManageAiFilter();
  const [instruction, setInstruction] = useState("");
  const [review, setReview] = useState<{
    action: "filter" | "keep";
    decision: AiFilterDecision;
  } | null>(null);

  const instructions = useMemo(
    () =>
      rules.filter(
        (rule) =>
          rule.kind === "ai-filter" && rule.name !== AI_FILTER_RULE_NAME,
      ),
    [rules],
  );
  const decisions = latestAiFilterDecisions(state).slice(0, 8);
  const updateSettings = (patch: {
    enabled?: boolean;
    autoFilter?: boolean;
    autoFilterThreshold?: number;
  }) => {
    manage.mutate(
      { mode: "settings", settings: patch },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.aiFilter.settingsFailed"),
          ),
      },
    );
  };

  const addInstruction = () => {
    const condition = instruction.trim();
    if (!condition || createRule.isPending) return;
    createRule.mutate(
      {
        name: `AI filter: ${condition.slice(0, 72)}`,
        condition,
        actions: [
          { type: "label", labelName: AI_FILTER_LABEL },
          { type: "archive" },
        ],
        kind: "ai-filter",
      },
      {
        onSuccess: () => setInstruction(""),
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.aiFilter.instructionFailed"),
          ),
      },
    );
  };

  if (isLoading || !state) {
    return (
      <div className="max-w-2xl space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("mail.aiFilter.title")}
          </h2>
          <Switch
            checked={state.enabled}
            onCheckedChange={(enabled) => updateSettings({ enabled })}
            aria-label={t("mail.aiFilter.toggle")}
          />
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-[13px] font-medium text-foreground">
              {t("mail.aiFilter.autoFilterTitle")}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={String(state.autoFilterThreshold)}
                onValueChange={(value) =>
                  updateSettings({
                    autoFilterThreshold: Number(value),
                  })
                }
                disabled={!state.autoFilter || manage.isPending}
              >
                <SelectTrigger
                  className="h-8 w-[76px] text-xs"
                  aria-label={t("mail.aiFilter.thresholdLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLD_OPTIONS.map((threshold) => (
                    <SelectItem key={threshold} value={String(threshold)}>
                      {Math.round(threshold * 100)}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch
                checked={state.autoFilter}
                onCheckedChange={(autoFilter) => updateSettings({ autoFilter })}
                aria-label={t("mail.aiFilter.autoFilterToggle")}
              />
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground">
                {t("mail.aiFilter.labelName")}
              </span>
              <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {AI_FILTER_LABEL}
              </code>
            </div>
            <Link
              to={`/all?label=${encodeURIComponent(AI_FILTER_LABEL)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t("mail.aiFilter.reviewLabel")}
              <IconArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">
            {t("mail.aiFilter.instructionsTitle")}
          </h3>
          <div className="rounded-lg border border-border/50 bg-card/50 px-3">
            <div className="flex items-end gap-2 border-b border-border/40 py-3">
              <Input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addInstruction();
                }}
                placeholder={t("mail.aiFilter.instructionPlaceholder")}
                className="h-8 flex-1 text-xs"
                maxLength={500}
              />
              <Button
                size="sm"
                className="h-8 shrink-0 px-2.5 text-xs"
                onClick={addInstruction}
                disabled={!instruction.trim() || createRule.isPending}
              >
                {createRule.isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconPlus className="size-3.5" />
                )}
                {t("mail.aiFilter.addInstruction")}
              </Button>
            </div>
            {instructions.length > 0 &&
              instructions.map((rule) => (
                <InstructionRow key={rule.id} rule={rule} />
              ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">
              {t("mail.aiFilter.activityTitle")}
            </h3>
            <Link
              to={`/all?label=${encodeURIComponent(AI_FILTER_LABEL)}`}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {t("mail.aiFilter.viewAll")}
            </Link>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/50 px-3">
            {decisions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t("mail.aiFilter.noActivity")}
              </div>
            ) : (
              decisions.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  onReview={(action, next) =>
                    setReview({ action, decision: next })
                  }
                />
              ))
            )}
          </div>
        </section>
      </div>

      {review && (
        <AiFilterDialog
          open
          onOpenChange={(open) => !open && setReview(null)}
          action={review.action}
          targets={[decisionTarget(review.decision)]}
        />
      )}
    </>
  );
}
