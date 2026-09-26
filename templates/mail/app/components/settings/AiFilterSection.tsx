import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import type {
  AiFilterDecision,
  AiFilterPreviewCorrection,
  AiFilterPreviewEmail,
  AiFilterPreviewMatch,
  AiFilterPreviewRule,
  AiFilterTarget,
} from "@shared/ai-filter";
import { AI_FILTER_LABEL, AI_FILTER_RULE_NAME } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import type { AutomationRule, EmailMessage } from "@shared/types";
import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { AiFilterDialog } from "@/components/email/AiFilterDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  latestAiFilterDecisions,
  useAiFilter,
  useManageAiFilter,
  usePreviewAiFilter,
  useRefineAiFilter,
} from "@/hooks/use-ai-filter";
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/hooks/use-automations";
import { useEmails } from "@/hooks/use-emails";
import { cn } from "@/lib/utils";

const THRESHOLD_OPTIONS = [0.85, 0.92, 0.97];
type RuleMode = "tag" | "spam" | "important";

type PreviewResult = {
  model: { engine: string; model: string } | null;
  rules: AiFilterPreviewRule[];
  emails: Array<AiFilterPreviewEmail & { matches: AiFilterPreviewMatch[] }>;
};

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

function ruleMode(rule: Pick<AutomationRule, "actions">): RuleMode {
  if (rule.actions.some((action) => action.type === "archive")) {
    return "spam";
  }
  return rule.actions.some(
    (action) =>
      action.type === "label" && action.labelName === AI_IMPORTANT_LABEL,
  )
    ? "important"
    : "tag";
}

function toPreviewEmail(email: EmailMessage): AiFilterPreviewEmail {
  return {
    id: email.id,
    threadId: email.threadId,
    accountEmail: email.accountEmail,
    from: email.from.email,
    to: email.to.map((recipient) => recipient.email).join(", "),
    subject: email.subject,
    snippet: email.snippet,
    labelIds: email.labelIds,
    date: email.date,
    isArchived: email.isArchived,
    isTrashed: email.isTrashed,
  };
}

function InstructionRow({
  rule,
  selected,
  onSelect,
}: {
  rule: AutomationRule;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const update = useUpdateAutomation();
  const remove = useDeleteAutomation();
  const mode = ruleMode(rule);

  return (
    <div
      className={cn(
        "group flex items-center gap-3 border-b border-border/40 px-3 py-3 last:border-0",
        selected && "bg-accent/25",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-sm leading-5",
              rule.enabled ? "text-foreground" : "text-muted-foreground/50",
            )}
          >
            {rule.condition}
          </p>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {mode === "spam"
              ? t("mail.aiFilter.spamMode")
              : mode === "important"
                ? t("mail.aiFilter.importantMode")
                : t("mail.aiFilter.tagMode")}
          </span>
        </div>
        {mode !== "spam" && (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {mode === "important"
              ? t("mail.aiFilter.importantLabel")
              : rule.actions.find((action) => action.type === "label")
                  ?.labelName}
          </p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={rule.enabled}
          onCheckedChange={(enabled) => {
            update.mutate({ id: rule.id, enabled });
          }}
          onClick={(event) => event.stopPropagation()}
          className="scale-90"
          aria-label={t("mail.aiFilter.toggleInstruction", {
            instruction: rule.condition,
          })}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            remove.mutate(rule.id);
          }}
          disabled={remove.isPending}
          aria-label={t("mail.aiFilter.deleteInstruction")}
        >
          {remove.isPending ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconTrash className="size-3.5" />
          )}
        </Button>
      </div>
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
  const jevMatch = /^Jev (?:confidence|match probability) (\d+)%$/.exec(
    decision.reason ?? "",
  );
  const reason = jevMatch
    ? t("mail.aiFilter.jevMatchProbability", { percent: jevMatch[1] })
    : decision.reason;

  return (
    <div className="flex items-start gap-3 border-b border-border/40 py-3 last:border-0">
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
        {reason && (
          <p
            className="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground/70"
            title={reason}
          >
            {reason}
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

function PreviewRow({
  email,
  match,
  correction,
  mode,
  onCorrectionChange,
}: {
  email: AiFilterPreviewEmail;
  match?: AiFilterPreviewMatch;
  correction: boolean;
  mode: RuleMode;
  onCorrectionChange: (checked: boolean) => void;
}) {
  const t = useT();
  const hasMatch = Boolean(match);
  const correctionLabel =
    mode === "spam"
      ? t("mail.aiFilter.notSpamShort")
      : t("mail.aiFilter.notMatchShort");

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/40 px-3 py-3 last:border-0">
      <Checkbox
        checked={correction}
        onCheckedChange={(checked) => onCorrectionChange(checked === true)}
        disabled={!hasMatch}
        className="mt-0.5"
        aria-label={`${correctionLabel}: ${email.subject}`}
      />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-foreground">
          {email.subject || t("mail.aiFilter.noSubject")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {email.from}
        </p>
        {correction && (
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            {correctionLabel}
          </p>
        )}
      </div>
      <span
        className={cn(
          "pt-0.5 text-[11px] tabular-nums",
          hasMatch
            ? "font-medium text-agent-kit-positive"
            : "text-muted-foreground/60",
        )}
      >
        {hasMatch
          ? `${Math.round((match?.confidence ?? 0) * 100)}%`
          : t("mail.aiFilter.noMatch")}
      </span>
    </div>
  );
}

export function AiFilterSection({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { data: state, isLoading } = useAiFilter();
  const { data: rules = [] } = useAutomations();
  const { data: emailData } = useEmails("inbox", undefined, undefined, {
    enabled: true,
  });
  const createRule = useCreateAutomation();
  const manage = useManageAiFilter();
  const preview = usePreviewAiFilter();
  const refine = useRefineAiFilter();
  const [mode, setMode] = useState<RuleMode>("tag");
  const [tagName, setTagName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string>();
  const [previewRuleId, setPreviewRuleId] = useState<string>();
  const [corrections, setCorrections] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState("");
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
  const enabledInstructions = useMemo(
    () => instructions.filter((rule) => rule.enabled),
    [instructions],
  );
  const selectedRule =
    enabledInstructions.find((rule) => rule.id === selectedRuleId) ??
    enabledInstructions[0];
  const recentEmails = useMemo(
    () =>
      (emailData ?? [])
        .filter((email) => !email.isArchived && !email.isTrashed)
        .slice(0, 20),
    [emailData],
  );
  const previewData =
    previewRuleId === selectedRule?.id
      ? (preview.data as PreviewResult | undefined)
      : undefined;
  const previewEmails = previewData?.emails ?? [];
  const previewRule = selectedRule
    ? previewData?.rules.find((rule) => rule.id === selectedRule.id)
    : undefined;
  const previewMode = selectedRule ? ruleMode(selectedRule) : mode;
  const correctionItems = useMemo<AiFilterPreviewCorrection[]>(
    () =>
      Object.entries(corrections)
        .filter(([, checked]) => checked)
        .map(([emailId]) => {
          const email = recentEmails.find((item) => item.id === emailId);
          if (!email) return null;
          return {
            emailId: email.id,
            sender: email.from.email,
            subject: email.subject,
            snippet: email.snippet,
            expectedMatch: false,
          };
        })
        .filter((item): item is AiFilterPreviewCorrection => Boolean(item)),
    [corrections, recentEmails],
  );

  const selectRule = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    setPreviewRuleId(undefined);
    setCorrections({});
    setFeedback("");
    preview.reset();
  };

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
    const labelName = tagName.trim();
    if (!condition || (mode === "tag" && !labelName) || createRule.isPending) {
      return;
    }
    const actions =
      mode === "spam"
        ? [
            { type: "label" as const, labelName: AI_FILTER_LABEL },
            { type: "archive" as const },
          ]
        : [
            {
              type: "label" as const,
              labelName: mode === "important" ? AI_IMPORTANT_LABEL : labelName,
            },
          ];
    createRule.mutate(
      {
        name: `AI ${mode}: ${condition.slice(0, 72)}`,
        condition,
        actions,
        kind: "ai-filter",
        domain: "mail",
      },
      {
        onSuccess: (rule) => {
          setInstruction("");
          if (mode === "tag") setTagName("");
          selectRule(rule.id);
          setComposerOpen(false);
          toast.success(t("mail.aiFilter.ruleAdded"));
        },
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.aiFilter.instructionFailed"),
          ),
      },
    );
  };

  const runPreview = () => {
    if (!selectedRule || recentEmails.length === 0 || preview.isPending) {
      if (!selectedRule) toast.error(t("mail.aiFilter.addRuleToPreview"));
      return;
    }
    setCorrections({});
    setPreviewRuleId(selectedRule.id);
    preview.mutate(
      { emails: recentEmails.map(toPreviewEmail) },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.aiFilter.previewFailed"),
          ),
      },
    );
  };

  const refineRule = () => {
    if (!selectedRule || correctionItems.length === 0 || refine.isPending) {
      return;
    }
    refine.mutate(
      {
        ruleId: selectedRule.id,
        corrections: correctionItems,
        comment: feedback.trim() || undefined,
      },
      {
        onSuccess: () => {
          setCorrections({});
          setFeedback("");
          toast.success(t("mail.aiFilter.instructionsUpdated"));
          window.setTimeout(() => {
            preview.mutate({ emails: recentEmails.map(toPreviewEmail) });
          }, 250);
        },
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
      <div className="max-w-4xl space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const enabledSwitch = (
    <Switch
      checked={state.enabled}
      onCheckedChange={(enabled) => updateSettings({ enabled })}
      aria-label={t("mail.aiFilter.toggle")}
    />
  );
  const decisions = latestAiFilterDecisions(state).slice(0, 8);
  const hasImportantRule = instructions.some(
    (rule) => ruleMode(rule) === "important",
  );

  return (
    <>
      <div className="max-w-4xl space-y-8 pb-10">
        {embedded ? (
          <SettingsGroup id="ai-filter-settings">
            <SettingsRow
              id="ai-filter-enabled"
              label={t("mail.aiFilter.title")}
              description={t("mail.aiFilter.subtitle")}
              control={enabledSwitch}
            />
          </SettingsGroup>
        ) : (
          <div className="flex items-center justify-between border-b border-border/50 pb-4">
            <h2 className="truncate text-[16px] font-semibold text-foreground">
              {t("mail.aiFilter.title")}
            </h2>
            {enabledSwitch}
          </div>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-foreground">
                {t("mail.aiFilter.rulesTitle")}
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setComposerOpen(true)}
              >
                {t("mail.aiFilter.newRule")}
              </Button>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40">
              {instructions.length > 0 ? (
                instructions.map((rule) => (
                  <InstructionRow
                    key={rule.id}
                    rule={rule}
                    selected={rule.id === selectedRule?.id}
                    onSelect={() => rule.enabled && selectRule(rule.id)}
                  />
                ))
              ) : (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t("mail.aiFilter.noInstructions")}
                </div>
              )}
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground">
                  {t("mail.aiFilter.previewTitle")}
                </h3>
                <p
                  className="mt-1 truncate text-[11px] text-muted-foreground"
                  title={t("mail.aiFilter.previewDescription")}
                >
                  {t("mail.aiFilter.previewScope")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {previewData?.model && (
                  <span className="text-[11px] text-muted-foreground">
                    {previewData.model.engine === "typesafe"
                      ? t("mail.aiFilter.jevBadge")
                      : t("mail.aiFilter.lunaBadge")}
                  </span>
                )}
                <Button
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={runPreview}
                  disabled={preview.isPending || recentEmails.length === 0}
                >
                  {preview.isPending && (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  )}
                  {t("mail.aiFilter.previewButton")}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40">
              {enabledInstructions.length > 1 && (
                <div className="border-b border-border/40 p-3">
                  <Select
                    value={selectedRule?.id}
                    onValueChange={setSelectedRuleId}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledInstructions.map((rule) => (
                        <SelectItem key={rule.id} value={rule.id}>
                          {rule.condition}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {previewEmails.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {recentEmails.length === 0
                    ? t("mail.aiFilter.noRecentMail")
                    : preview.isPending
                      ? t("mail.aiFilter.previewRunning")
                      : instructions.length === 0
                        ? t("mail.aiFilter.addRuleToPreview")
                        : t("mail.aiFilter.previewEmpty")}
                </div>
              ) : (
                <>
                  <p className="border-b border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
                    {t("mail.aiFilter.feedbackLabel")}
                    {correctionItems.length > 0 &&
                      ` (${correctionItems.length})`}
                  </p>
                  {previewEmails.map((email) => (
                    <PreviewRow
                      key={email.id}
                      email={email}
                      match={email.matches.find(
                        (match) => match.ruleId === previewRule?.id,
                      )}
                      correction={Boolean(corrections[email.id])}
                      mode={previewMode}
                      onCorrectionChange={(checked) =>
                        setCorrections((current) => ({
                          ...current,
                          [email.id]: checked,
                        }))
                      }
                    />
                  ))}
                  {correctionItems.length > 0 && (
                    <div className="border-t border-border/40 p-3">
                      <Textarea
                        value={feedback}
                        onChange={(event) => setFeedback(event.target.value)}
                        placeholder={t("mail.aiFilter.feedbackPlaceholder")}
                        className="min-h-16 resize-none text-xs"
                        maxLength={1_000}
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={refineRule}
                          disabled={refine.isPending}
                        >
                          {refine.isPending && (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          )}
                          {t("mail.aiFilter.refineButton")}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        <details className="border-t border-border/50 pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium text-foreground">
            <span>{t("settings.automations")}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {state.autoFilter
                ? `${Math.round(state.autoFilterThreshold * 100)}%`
                : ""}
            </span>
          </summary>
          <div className="mt-3 rounded-lg border border-border/50 bg-card/40">
            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <p className="min-w-0 text-[12px] text-foreground">
                {t("mail.aiFilter.autoFilterTitle")}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Select
                  value={String(state.autoFilterThreshold)}
                  onValueChange={(value) =>
                    updateSettings({ autoFilterThreshold: Number(value) })
                  }
                  disabled={!state.autoFilter || manage.isPending}
                >
                  <SelectTrigger
                    className="h-8 w-[68px] text-xs"
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
                  onCheckedChange={(autoFilter) =>
                    updateSettings({ autoFilter })
                  }
                  aria-label={t("mail.aiFilter.autoFilterToggle")}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border/40 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className="shrink-0 text-muted-foreground">
                  {t("mail.aiFilter.labelName")}
                </span>
                <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {AI_FILTER_LABEL}
                </code>
              </div>
              <Link
                to={`/all?label=${encodeURIComponent(AI_FILTER_LABEL)}`}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                {t("mail.aiFilter.reviewLabel")}
              </Link>
            </div>
            {hasImportantRule && (
              <div className="flex items-center justify-between gap-3 border-t border-border/40 px-3 py-3">
                <span className="text-[12px] text-muted-foreground">
                  {t("mail.aiFilter.importantLabel")}
                </span>
                <Link
                  to="/inbox?tab=important"
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  {t("mail.aiFilter.reviewImportant")}
                </Link>
              </div>
            )}
          </div>
        </details>

        {decisions.length > 0 && (
          <section>
            <div className="flex items-center justify-between">
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
            <div className="mt-3 rounded-lg border border-border/50 bg-card/40 px-3">
              {decisions.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  onReview={(action, next) =>
                    setReview({ action, decision: next })
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mail.aiFilter.newRule")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as RuleMode)}
            >
              <SelectTrigger
                className="h-9 w-full text-sm"
                aria-label={t("mail.aiFilter.rulesTitle")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tag">
                  {t("mail.aiFilter.tagMode")}
                </SelectItem>
                <SelectItem value="spam">
                  {t("mail.aiFilter.spamMode")}
                </SelectItem>
                <SelectItem value="important">
                  {t("mail.aiFilter.importantMode")}
                </SelectItem>
              </SelectContent>
            </Select>
            {mode === "tag" && (
              <Input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder={t("mail.aiFilter.tagNamePlaceholder")}
                aria-label={t("mail.aiFilter.tagNamePlaceholder")}
                className="h-9 text-sm"
                maxLength={128}
              />
            )}
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  addInstruction();
                }
              }}
              placeholder={
                mode === "spam"
                  ? t("mail.aiFilter.spamPlaceholder")
                  : mode === "important"
                    ? t("mail.aiFilter.importantPlaceholder")
                    : t("mail.aiFilter.tagPlaceholder")
              }
              aria-label={t("mail.aiFilter.instructionsTitle")}
              className="min-h-28 resize-none text-sm"
              maxLength={2_000}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setComposerOpen(false)}
              disabled={createRule.isPending}
            >
              {t("settings.cancel")}
            </Button>
            <Button
              onClick={addInstruction}
              disabled={
                !instruction.trim() ||
                (mode === "tag" && !tagName.trim()) ||
                createRule.isPending
              }
            >
              {createRule.isPending && (
                <IconLoader2 className="size-4 animate-spin" />
              )}
              {t("mail.aiFilter.addInstruction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
