import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useFirstRunOnboardingGateOwnsSurface,
  useOnboardingPreviewMode,
} from "@agent-native/core/client/onboarding";
import { AI_FILTER_LABEL } from "@shared/ai-filter";
import type { AiFilterBackfillStatus } from "@shared/ai-filter-backfill";
import {
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  type AiFilterRuleMode,
} from "@shared/ai-filter-rules";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import type { AutomationAction, AutomationRule } from "@shared/types";
import {
  IconArchive,
  IconCheck,
  IconFilter,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { AiRulePromptField } from "@/components/settings/AiRulePromptField";
import {
  JevAvailabilityError,
  JevConnectionPrompt,
} from "@/components/settings/JevConnectionPrompt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAiFilterBackfillStatus,
  useManageAiFilterBackfill,
} from "@/hooks/use-ai-filter";
import {
  useAutomations,
  useCreateAutomation,
  useUpdateAutomation,
} from "@/hooks/use-automations";
import { useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";
import { labelTabHref } from "@/lib/inbox-tabs";
import { getLabelStyle } from "@/lib/label-colors";
import { cn } from "@/lib/utils";

export const TAG_SUGGESTIONS = [
  [
    "receipts",
    "mail.sort.aiSetupTagReceipts",
    "mail.sort.aiSetupPromptReceipts",
  ],
  ["updates", "mail.sort.aiSetupTagUpdates", "mail.sort.aiSetupPromptUpdates"],
  ["github", "mail.sort.aiSetupTagGitHub", "mail.sort.aiSetupPromptGitHub"],
  [
    "calendar",
    "mail.sort.aiSetupTagCalendar",
    "mail.sort.aiSetupPromptCalendar",
  ],
  ["travel", "mail.sort.aiSetupTagTravel", "mail.sort.aiSetupPromptTravel"],
  ["finance", "mail.sort.aiSetupTagFinance", "mail.sort.aiSetupPromptFinance"],
] as const;

type SetupStep = 0 | 1 | 2 | 3;

type ReviewDestination = {
  href: string;
  labelName: string;
  mode: AiFilterRuleMode;
};

function reviewDestinationForRule(
  rule: Pick<AutomationRule, "actions">,
): ReviewDestination | null {
  const mode = aiFilterRuleMode(rule);
  if (!mode) return null;
  const labelName = aiFilterRuleLabelName(rule);
  return {
    href: labelName ? labelTabHref(labelName) : "/archive",
    labelName,
    mode,
  };
}

function SetupRuleRow({
  icon,
  title,
  condition,
  enabled,
  onConditionChange,
  onEnabledChange,
}: {
  icon: React.ReactNode;
  title: string;
  condition: string;
  enabled: boolean;
  onConditionChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
}) {
  const t = useT();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <label className="min-w-0 flex-1 space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Input
          value={condition}
          onChange={(event) => onConditionChange(event.target.value)}
          aria-label={title}
        />
      </label>
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label={t("mail.aiFilter.toggleInstruction", {
          instruction: title,
        })}
      />
    </div>
  );
}

function SetupSurface({
  embedded,
  visible,
  onClose,
  children,
}: {
  embedded: boolean;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  if (embedded) return children;
  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">{children}</DialogContent>
    </Dialog>
  );
}

function SetupResults({
  status,
  loading,
  hasRun,
  failed,
  reviewDestinationsByRuleId,
  onUndo,
  onReview,
  onTeach,
}: {
  status: AiFilterBackfillStatus | undefined;
  loading: boolean;
  hasRun: boolean;
  failed: boolean;
  reviewDestinationsByRuleId: Record<string, ReviewDestination>;
  onUndo: (undoToken: string) => Promise<void>;
  onReview: () => void;
  onTeach: () => void;
}) {
  const t = useT();
  const previews = useMemo(() => {
    const byId = new Map<
      string,
      {
        id: string;
        from: string;
        subject: string;
        labels: string[];
        archived: boolean;
      }
    >();
    for (const preview of (status?.perRule ?? []).flatMap(
      (rule) => rule.previews,
    )) {
      const current = byId.get(preview.id);
      byId.set(preview.id, {
        ...preview,
        labels: [...new Set([...(current?.labels ?? []), ...preview.labels])],
        archived: current?.archived === true || preview.archived,
      });
    }
    return [...byId.values()].slice(0, 5);
  }, [status?.perRule]);
  const reviewDestinations = useMemo(() => {
    const byHref = new Map<string, ReviewDestination>();
    for (const rule of status?.perRule ?? []) {
      if (rule.matchedCount === 0) continue;
      const destination = reviewDestinationsByRuleId[rule.ruleId];
      if (destination) byHref.set(destination.href, destination);
    }
    return [...byHref.values()];
  }, [status?.perRule, reviewDestinationsByRuleId]);
  const total = status?.totalThreads ?? 0;
  const processed = status?.processedThreads ?? 0;
  const totalKnown = total > 0;
  const percent = totalKnown ? Math.min(100, (processed / total) * 100) : null;
  const running =
    loading ||
    status?.status === "queued" ||
    status?.status === "running" ||
    status?.status === "undoing";
  const undone = status?.status === "undone";
  const hasFailed =
    status?.status === "failed" || (!loading && hasRun && failed);

  return (
    <div className="space-y-5">
      {running ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-center gap-3">
            <IconLoader2 className="size-4 animate-spin text-primary" />
            <p className="text-sm font-medium">
              {status?.status === "undoing"
                ? t("mail.sort.aiSetupUndoing")
                : totalKnown
                  ? t("mail.sort.aiSetupSortingProgress", {
                      processed,
                      total,
                    })
                  : t("mail.sort.aiSetupFindingRecentMail")}
            </p>
          </div>
          <Progress
            value={percent}
            max={100}
            aria-label={t("mail.sort.aiSetupSortingHeadline")}
            className="h-1.5"
          />
        </div>
      ) : null}
      {hasFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("mail.sort.aiSetupSortingFailed")}
        </p>
      ) : null}
      {undone ? (
        <p className="text-sm text-muted-foreground">
          {t("mail.sort.aiSetupUndoComplete", {
            count: status.restoredThreads ?? 0,
          })}
        </p>
      ) : null}
      {status && !undone && status.perRule.length > 0 ? (
        <div className="space-y-2">
          {status.perRule.map((rule) => (
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
        </div>
      ) : null}
      {status && !undone && status.failedThreads > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {t("mail.sort.aiSetupPartialFailure", {
            count: status.failedThreads,
          })}
        </p>
      ) : null}
      {status?.status === "completed" && status.matchedThreads === 0 ? (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm">
          <p className="font-medium">{t("mail.sort.aiSetupNoMatches")}</p>
        </div>
      ) : null}
      {status && !undone && previews.length > 0 ? (
        <div className="space-y-2">
          {previews.map((preview) => (
            <div
              key={preview.id}
              className="rounded-xl border border-border/70 bg-card p-3"
            >
              <p className="truncate text-sm font-medium">
                {preview.subject || t("mail.aiFilter.noSubject")}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {preview.from || t("mail.aiFilter.unknownSender")}
              </p>
              {preview.labels.length > 0 || preview.archived ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.labels.map((label) => (
                    <span
                      key={label}
                      className={cn(
                        "label-badge max-w-40 truncate",
                        getLabelStyle(label).bg,
                        getLabelStyle(label).text,
                      )}
                    >
                      {label === AI_FILTER_LABEL
                        ? t("mail.aiFilter.filteredMode")
                        : label === AI_IMPORTANT_LABEL
                          ? t("mail.aiFilter.importantMode")
                          : label}
                    </span>
                  ))}
                  {preview.archived ? (
                    <span
                      className={cn(
                        "label-badge",
                        getLabelStyle("archive").bg,
                        getLabelStyle("archive").text,
                      )}
                    >
                      {t("mail.views.archive")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {!status && !loading && !hasRun ? (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm">
          <p className="font-medium">{t("mail.sort.aiSetupNoRules")}</p>
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t("mail.sort.aiSetupChatTip")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={onTeach}
        >
          {t("mail.sort.aiSetupChatPrompt")}
        </Button>
      </div>
      {status && !running && !undone ? (
        <div className="flex flex-wrap gap-2">
          {reviewDestinations.map(({ href, labelName, mode }) => (
            <Button key={href} asChild variant="outline" onClick={onReview}>
              <a href={href}>
                {mode === "filtered"
                  ? t("mail.aiFilter.filteredMode")
                  : mode === "important"
                    ? t("mail.aiFilter.importantMode")
                    : mode === "archive"
                      ? t("mail.aiFilter.skipInboxMode")
                      : labelName}
              </a>
            </Button>
          ))}
          {status.undoToken ? (
            <Button
              variant="ghost"
              onClick={() => void onUndo(status.undoToken!)}
            >
              {t("mail.actions.undo")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AiInboxSetup({
  forceOpen = false,
  embedded = false,
  onOpenChange,
  onComplete,
  onSkipSetup,
}: {
  forceOpen?: boolean;
  embedded?: boolean;
  onOpenChange?: (open: boolean) => void;
  onComplete?: () => void;
  onSkipSetup?: () => void;
}) {
  const t = useT();
  const firstRunOnboardingOwnsSurface = useFirstRunOnboardingGateOwnsSurface();
  const onboardingPreview = useOnboardingPreviewMode();
  const { data: settings } = useSettings();
  const { data: rules = [], isLoading: rulesLoading } = useAutomations();
  const googleStatus = useGoogleAuthStatus();
  const connected = (googleStatus.data?.accounts.length ?? 0) > 0;
  const canOfferGoogleOAuthSetup = useMemo(
    () => shouldOfferGoogleOAuthSetup(),
    [],
  );
  const jevAvailability = useActionQuery(
    "get-jev-availability",
    {},
    {
      enabled: connected,
      staleTime: 0,
      // request-storm-allow: the shared status query revalidates API-key setup when its settings tab returns.
      refetchOnWindowFocus: true,
    },
  );
  const jevAvailabilityResolved =
    !jevAvailability.isError && jevAvailability.data != null;
  const jevConfigured =
    jevAvailabilityResolved && jevAvailability.data?.configured === true;
  const createRuleMutation = useCreateAutomation();
  const updateRuleMutation = useUpdateAutomation();
  const updateSettings = useUpdateSettings();
  const [step, setStep] = useState<SetupStep>(0);
  const [backfillReviewDestinations, setBackfillReviewDestinations] = useState<
    Record<string, ReviewDestination>
  >({});
  const [selectedTags, setSelectedTags] = useState(
    () => new Set<string>(["receipts", "github"]),
  );
  const [customTagSelected, setCustomTagSelected] = useState(false);
  const [customTagName, setCustomTagName] = useState("");
  const [customTagPrompt, setCustomTagPrompt] = useState("");
  const [importantPrompt, setImportantPrompt] = useState("");
  const [archivePrompt, setArchivePrompt] = useState(() =>
    t("mail.sort.aiSetupArchiveExample"),
  );
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const [archiveUserOptedOut, setArchiveUserOptedOut] = useState(false);
  const [spamPrompt, setSpamPrompt] = useState(() =>
    t("mail.sort.aiSetupFilteredExample"),
  );
  const [spamEnabled, setSpamEnabled] = useState(false);
  const [spamUserOptedOut, setSpamUserOptedOut] = useState(false);
  const [customCleanupOpen, setCustomCleanupOpen] = useState(false);
  const [customCleanupPrompt, setCustomCleanupPrompt] = useState("");
  const [customCleanupMode, setCustomCleanupMode] = useState<
    "archive" | "filtered"
  >("archive");
  const [saving, setSaving] = useState(false);
  const [backfillRunId, setBackfillRunId] = useState<string | null>(null);
  const previousForceOpen = useRef(forceOpen);
  const startBackfill = useManageAiFilterBackfill();
  const backfillStatus = useAiFilterBackfillStatus(backfillRunId);

  const aiRules = useMemo(
    () =>
      rules.filter(
        (rule) => rule.domain === "mail" && rule.kind === "ai-filter",
      ),
    [rules],
  );
  const visible =
    (embedded || (!firstRunOnboardingOwnsSurface && !onboardingPreview)) &&
    connected &&
    !googleStatus.isLoading &&
    !jevAvailability.isLoading &&
    (forceOpen ||
      (!rulesLoading &&
        settings?.aiSetupCompleted !== true &&
        aiRules.length === 0));

  useEffect(() => {
    const wasForceOpen = previousForceOpen.current;
    if (!forceOpen) previousForceOpen.current = false;
    if (!visible) return;
    previousForceOpen.current = forceOpen;
    if (forceOpen && !wasForceOpen) {
      setStep(0);
      setBackfillRunId(null);
      setBackfillReviewDestinations({});
      setArchiveUserOptedOut(false);
      setSpamUserOptedOut(false);
    }
  }, [forceOpen, visible]);

  const complete = async () => {
    try {
      await updateSettings.mutateAsync({ aiSetupCompleted: true });
      onOpenChange?.(false);
      onComplete?.();
    } catch {
      toast.error(t("mail.aiFilter.settingsFailed"));
    }
  };

  const skipSetup = async () => {
    if (saving || updateSettings.isPending) return;
    try {
      await updateSettings.mutateAsync({ aiSetupCompleted: true });
      onSkipSetup?.();
    } catch {
      toast.error(t("mail.aiFilter.settingsFailed"));
    }
  };

  const saveRule = async (condition: string, actions: AutomationAction[]) => {
    const trimmed = condition.trim();
    if (!trimmed) return null;
    const existing = aiRules.find(
      (rule) =>
        rule.condition.trim() === trimmed &&
        JSON.stringify(rule.actions) === JSON.stringify(actions),
    );
    if (existing) {
      return existing.enabled
        ? existing
        : updateRuleMutation.mutateAsync({ id: existing.id, enabled: true });
    }
    return createRuleMutation.mutateAsync({
      name: trimmed.slice(0, 72),
      condition: trimmed,
      actions,
      kind: "ai-filter",
      domain: "mail",
    });
  };

  const saveStep = async (skipCleanup = false) => {
    if (step < 2) {
      setStep((current) => (current + 1) as SetupStep);
      return;
    }
    if (!jevConfigured || rulesLoading) return;

    setSaving(true);
    try {
      const ruleIds: string[] = [];
      const reviewDestinationsByRuleId: Record<string, ReviewDestination> = {};
      const includeRule = (rule: AutomationRule | null) => {
        if (!rule) return;
        ruleIds.push(rule.id);
        const destination = reviewDestinationForRule(rule);
        if (destination) reviewDestinationsByRuleId[rule.id] = destination;
      };
      for (const [id, nameKey, promptKey] of TAG_SUGGESTIONS) {
        if (!selectedTags.has(id)) continue;
        const labelName = t(nameKey);
        const rule = await saveRule(t(promptKey), [
          { type: "label", labelName },
        ]);
        includeRule(rule);
      }

      if (customTagSelected && customTagName.trim() && customTagPrompt.trim()) {
        const labelName = customTagName.trim();
        const rule = await saveRule(customTagPrompt, [
          { type: "label", labelName },
        ]);
        includeRule(rule);
      }

      if (importantPrompt.trim()) {
        const rule = await saveRule(importantPrompt, [
          { type: "label", labelName: AI_IMPORTANT_LABEL },
        ]);
        includeRule(rule);
      }
      if (!skipCleanup) {
        if (archiveEnabled && archivePrompt.trim()) {
          const rule = await saveRule(archivePrompt, [{ type: "archive" }]);
          includeRule(rule);
        }
        if (spamEnabled && spamPrompt.trim()) {
          const rule = await saveRule(spamPrompt, [
            { type: "label", labelName: AI_FILTER_LABEL },
            { type: "archive" },
          ]);
          includeRule(rule);
        }
        if (customCleanupPrompt.trim()) {
          const actions =
            customCleanupMode === "archive"
              ? [{ type: "archive" } as const]
              : [
                  { type: "label", labelName: AI_FILTER_LABEL } as const,
                  { type: "archive" } as const,
                ];
          const rule = await saveRule(customCleanupPrompt, actions);
          includeRule(rule);
        }
      }

      if (ruleIds.length > 0) {
        const result = await startBackfill.mutateAsync({
          operation: "start",
          ruleIds: [...new Set(ruleIds)],
        });
        setBackfillRunId(result.runId);
        setBackfillReviewDestinations(reviewDestinationsByRuleId);
      }
      setStep(3);
      try {
        await updateSettings.mutateAsync({ aiSetupCompleted: true });
      } catch {
        toast.error(t("mail.aiFilter.settingsFailed"));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (step === 0) {
      setSelectedTags(new Set());
      setCustomTagSelected(false);
    }
    if (step === 1) setImportantPrompt("");
    if (step === 2) {
      if (jevConfigured) void saveStep(true);
      else setStep(3);
      return;
    }
    setStep((current) => (current + 1) as SetupStep);
  };

  const headline =
    step === 0
      ? t("mail.sort.aiSetupTagsHeadline")
      : step === 1
        ? t("mail.sort.aiSetupImportantHeadline")
        : step === 2
          ? t("mail.sort.aiSetupSkipInboxHeadline")
          : t("mail.sort.aiSetupSortingHeadline");
  const stepCount = 4;
  const progressIndex = step;
  const customTagIncomplete =
    step === 0 &&
    customTagSelected &&
    (!customTagName.trim() || !customTagPrompt.trim());

  if (
    forceOpen &&
    (googleStatus.isLoading || (connected && jevAvailability.isLoading))
  ) {
    return (
      <SetupSurface
        embedded={embedded}
        visible
        onClose={() => {
          onOpenChange?.(false);
          void complete();
        }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-6" aria-busy="true">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-28" />
        </div>
      </SetupSurface>
    );
  }

  if (embedded && forceOpen && !connected) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        {googleStatus.data?.configured === true ||
        canOfferGoogleOAuthSetup ||
        googleStatus.isError ? (
          <GoogleConnectBanner variant="hero" />
        ) : (
          <div className="py-6">
            <h1 className="text-lg font-semibold">
              {t("mail.googleConnect.connectTitle")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("mail.googleConnect.connectionNotConfigured")}
            </p>
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void skipSetup()}
            disabled={saving || updateSettings.isPending}
          >
            {t("mail.sort.aiSetupSkipSetup")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SetupSurface
      embedded={embedded}
      visible={visible}
      onClose={() => {
        onOpenChange?.(false);
        void complete();
      }}
    >
      <>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center overflow-y-auto">
          <div className="mb-6 flex items-center justify-between gap-3">
            {embedded ? (
              <h1 className="text-lg font-semibold">{headline}</h1>
            ) : (
              <DialogHeader>
                <DialogTitle>{headline}</DialogTitle>
              </DialogHeader>
            )}
            {embedded && step < 3 && onSkipSetup ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void skipSetup()}
                disabled={saving || updateSettings.isPending}
              >
                {t("mail.sort.aiSetupSkipSetup")}
              </Button>
            ) : null}
          </div>
          <div
            className="mb-8 flex items-center gap-2"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={stepCount}
            aria-valuenow={progressIndex + 1}
            aria-label={`${progressIndex + 1}/${stepCount}`}
          >
            {Array.from({ length: stepCount }, (_, index) => index).map(
              (index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 rounded-full ${index <= progressIndex ? "bg-primary" : "bg-muted"}`}
                />
              ),
            )}
          </div>
          {jevAvailability.isError ? (
            <div className="mb-5">
              <JevAvailabilityError
                onRetry={() => void jevAvailability.refetch()}
                retrying={jevAvailability.isFetching}
              />
            </div>
          ) : null}
          {step === 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {TAG_SUGGESTIONS.map(([id, nameKey]) => {
                  const selected = selectedTags.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSelectedTags((current) => {
                          const next = new Set(current);
                          if (selected) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {selected ? <IconCheck className="size-3.5" /> : null}
                      {t(nameKey)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={customTagSelected}
                  onClick={() => setCustomTagSelected((selected) => !selected)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${customTagSelected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {customTagSelected ? (
                    <IconCheck className="size-3.5" />
                  ) : null}
                  {t("mail.sort.aiSetupCustomTag")}
                </button>
              </div>
              {customTagSelected && (
                <div className="space-y-3">
                  <Input
                    value={customTagName}
                    onChange={(event) => setCustomTagName(event.target.value)}
                    placeholder={t("mail.aiFilter.tagNamePlaceholder")}
                    aria-label={t("mail.aiFilter.tagNamePlaceholder")}
                  />
                  <AiRulePromptField
                    value={customTagPrompt}
                    onChange={setCustomTagPrompt}
                    label={t("mail.aiFilter.tagPlaceholder")}
                    placeholder={t("mail.aiFilter.tagPlaceholder")}
                  />
                </div>
              )}
            </div>
          ) : step === 1 ? (
            <Input
              value={importantPrompt}
              onChange={(event) => setImportantPrompt(event.target.value)}
              aria-label={headline}
              placeholder={t("mail.sort.aiSetupImportantExample")}
              className="h-12"
            />
          ) : step === 2 ? (
            <div className="space-y-3">
              <SetupRuleRow
                icon={<IconArchive className="size-4" />}
                title={t("mail.aiFilter.skipInboxMode")}
                condition={archivePrompt}
                enabled={archiveEnabled}
                onConditionChange={(value) => {
                  setArchivePrompt(value);
                  if (!archiveUserOptedOut) setArchiveEnabled(!!value.trim());
                }}
                onEnabledChange={(enabled) => {
                  setArchiveEnabled(enabled);
                  setArchiveUserOptedOut(!enabled);
                }}
              />
              <SetupRuleRow
                icon={<IconFilter className="size-4" />}
                title={t("mail.aiFilter.filteredMode")}
                condition={spamPrompt}
                enabled={spamEnabled}
                onConditionChange={(value) => {
                  setSpamPrompt(value);
                  if (!spamUserOptedOut) setSpamEnabled(!!value.trim());
                }}
                onEnabledChange={(enabled) => {
                  setSpamEnabled(enabled);
                  setSpamUserOptedOut(!enabled);
                }}
              />
              {customCleanupOpen ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3 sm:flex-nowrap">
                  <div className="flex shrink-0 rounded-lg bg-muted p-1">
                    {(["archive", "filtered"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={customCleanupMode === mode}
                        onClick={() => setCustomCleanupMode(mode)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${customCleanupMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                      >
                        {t(
                          mode === "archive"
                            ? "mail.aiFilter.skipInboxMode"
                            : "mail.aiFilter.filteredMode",
                        )}
                      </button>
                    ))}
                  </div>
                  <Input
                    autoFocus
                    value={customCleanupPrompt}
                    onChange={(event) =>
                      setCustomCleanupPrompt(event.target.value)
                    }
                    placeholder={t("mail.aiFilter.instructionPlaceholder")}
                    aria-label={t("mail.aiFilter.instructionPlaceholder")}
                    className="h-9 min-w-40 flex-1"
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustomCleanupOpen(true)}
                >
                  <IconPlus className="size-4" />
                  {t("mail.aiFilter.newRule")}
                </Button>
              )}
              {!jevConfigured ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                  <JevConnectionPrompt
                    showHeading={false}
                    onConnected={() => void jevAvailability.refetch()}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <SetupResults
              status={backfillStatus.data}
              reviewDestinationsByRuleId={backfillReviewDestinations}
              loading={
                startBackfill.isPending ||
                (backfillRunId !== null &&
                  !backfillStatus.data &&
                  (backfillStatus.isLoading || backfillStatus.isFetching))
              }
              hasRun={backfillRunId !== null}
              failed={backfillStatus.isError}
              onUndo={async (undoToken) => {
                if (!backfillRunId) return;
                await startBackfill.mutateAsync({
                  operation: "undo",
                  runId: backfillRunId,
                  undoToken,
                });
                await backfillStatus.refetch();
              }}
              onReview={() => void complete()}
              onTeach={() => {
                sendToAgentChat({
                  message: t("mail.sort.aiSetupChatPrompt"),
                  submit: false,
                  openSidebar: true,
                });
                void complete();
              }}
            />
          )}
          <div
            className={cn(
              "mt-8 flex items-center",
              step === 3 ? "justify-end" : "justify-between",
            )}
          >
            <div className="flex items-center gap-1">
              {step > 0 && step < 3 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setStep((current) => (current - 1) as SetupStep)
                  }
                  disabled={saving}
                >
                  {t("mail.thread.back")}
                </Button>
              )}
              {step < 3 ? (
                <Button
                  variant="ghost"
                  onClick={() => void skip()}
                  disabled={
                    saving || (step === 2 && jevConfigured && rulesLoading)
                  }
                >
                  {t("mail.sort.aiSetupSkip")}
                </Button>
              ) : null}
            </div>
            <Button
              onClick={() => (step === 3 ? void complete() : void saveStep())}
              disabled={
                step < 3 &&
                (saving ||
                  customTagIncomplete ||
                  (step === 1 && !importantPrompt.trim()) ||
                  (step === 2 && (!jevConfigured || rulesLoading)))
              }
              aria-busy={saving || (step === 2 && rulesLoading)}
            >
              {saving || (step === 2 && rulesLoading) ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : null}
              {step === 3
                ? t("mail.sort.aiSetupDone")
                : step === 2
                  ? t("mail.sort.aiSetupSortInbox")
                  : t("mail.sort.aiSetupContinue")}
            </Button>
          </div>
        </div>
      </>
    </SetupSurface>
  );
}
