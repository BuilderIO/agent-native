import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ONBOARDING_PRIMARY_BUTTON_CLASS,
  OnboardingStepLayout,
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
  IconArrowRight,
  IconCheck,
  IconLoader2,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import {
  JevAvailabilityError,
  JevConnectionPrompt,
} from "@/components/settings/JevConnectionPrompt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
type CustomTag = {
  id: string;
  name: string;
  condition: string;
};

const PENDING_SETUP_RULE_IDS = "mail.ai-setup.pending-rule-ids";

const IMPORTANT_SUGGESTIONS = [
  "mail.sort.aiSetupImportantBoss",
  "mail.sort.aiSetupImportantReply",
  "mail.sort.aiSetupImportantDeadlines",
  "mail.sort.aiSetupImportantCustomers",
  "mail.sort.aiSetupImportantGitHub",
  "mail.sort.aiSetupImportantCalendar",
] as const;

const SKIP_INBOX_SUGGESTIONS = [
  "mail.sort.aiSetupSkipNewsletters",
  "mail.sort.aiSetupSkipPromotions",
  "mail.sort.aiSetupSkipBots",
  "mail.sort.aiSetupSkipColdSales",
  "mail.sort.aiSetupSkipRecruiters",
  "mail.sort.aiSetupSkipSocial",
] as const;

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
  onRetry,
  compactReviewLinks = false,
  showChatSuggestion = true,
}: {
  status: AiFilterBackfillStatus | undefined;
  loading: boolean;
  hasRun: boolean;
  failed: boolean;
  reviewDestinationsByRuleId: Record<string, ReviewDestination>;
  onUndo: (undoToken: string) => Promise<void>;
  onReview: () => void;
  onTeach: () => void;
  onRetry?: () => void;
  compactReviewLinks?: boolean;
  showChatSuggestion?: boolean;
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
        <div className="space-y-3">
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
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            {t("mail.sort.aiSetupSortingFailed")}
          </p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t("mail.sort.aiSetupRetry")}
            </Button>
          ) : null}
        </div>
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
          {status.perRule.map((rule) => {
            const destination = reviewDestinationsByRuleId[rule.ruleId];
            const count = t("mail.sort.aiSetupRuleCount", {
              count: rule.matchedCount,
            });
            return compactReviewLinks && destination ? (
              <a
                key={rule.ruleId}
                href={destination.href}
                onClick={onReview}
                className="flex items-center gap-2 rounded-md py-1 text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {rule.name}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {count}
                </span>
                <IconArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <div
                key={rule.ruleId}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {rule.name}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {count}
                </span>
              </div>
            );
          })}
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
        <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card">
          {previews.map((preview) => (
            <div key={preview.id} className="p-3">
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
      {showChatSuggestion ? (
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
      ) : null}
      {status && !running && !undone ? (
        <div className="flex flex-wrap gap-2">
          {!compactReviewLinks
            ? reviewDestinations.map(({ href, labelName, mode }) => (
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
              ))
            : null}
          {!compactReviewLinks && status.undoToken ? (
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

function readPendingSetupRuleIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.sessionStorage.getItem(PENDING_SETUP_RULE_IDS);
    if (value === null) return [];
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) && ids.every((id) => typeof id === "string")
      ? ids
      : [];
    // coercion-ok: unreadable pending state means no onboarding rules may be backfilled.
  } catch {
    return [];
  }
}

function suggestionLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toggleSuggestion(
  value: string,
  onChange: (next: string) => void,
  suggestion: string,
) {
  const lines = suggestionLines(value);
  onChange(
    lines.includes(suggestion)
      ? lines.filter((line) => line !== suggestion).join("\n")
      : [...lines, suggestion].join("\n"),
  );
}

export function AiInboxSetup({
  forceOpen = false,
  embedded = false,
  firstRunStage,
  onStepChange,
  onOpenChange,
  onComplete,
  onSkip,
}: {
  forceOpen?: boolean;
  embedded?: boolean;
  firstRunStage?: "preferences" | "sorting";
  onStepChange?: (stepIndex: number) => void;
  onOpenChange?: (open: boolean) => void;
  onComplete?: () => void;
  onSkip?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const firstRunOnboardingOwnsSurface = useFirstRunOnboardingGateOwnsSurface();
  const onboardingPreview = useOnboardingPreviewMode();
  const { data: settings } = useSettings();
  const { data: rules = [], isLoading: rulesLoading } = useAutomations();
  const googleStatus = useGoogleAuthStatus();
  const connected =
    googleStatus.isSuccess &&
    !googleStatus.isError &&
    (googleStatus.data?.accounts.length ?? 0) > 0;
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
  const startBackfill = useManageAiFilterBackfill();
  const [step, setStep] = useState<SetupStep>(() =>
    firstRunStage === "sorting" ? 3 : 0,
  );
  const [selectedTags, setSelectedTags] = useState(
    () => new Set<string>(["receipts", "github"]),
  );
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [importantPrompt, setImportantPrompt] = useState("");
  const [archivePrompt, setArchivePrompt] = useState("");
  const importantTextareaRef = useRef<HTMLTextAreaElement>(null);
  const focusBossSuggestionCaret = useRef(false);
  const [saving, setSaving] = useState(false);
  const [backfillRunId, setBackfillRunId] = useState<string | null>(null);
  const [backfillStartFailed, setBackfillStartFailed] = useState(false);
  const [backfillReviewDestinations, setBackfillReviewDestinations] = useState<
    Record<string, ReviewDestination>
  >({});
  const [pendingRuleIds] = useState<string[]>(() =>
    firstRunStage === "sorting" ? readPendingSetupRuleIds() : [],
  );
  const previousForceOpen = useRef(forceOpen);
  const backfillStarted = useRef(false);
  const backfillStatus = useAiFilterBackfillStatus(backfillRunId);

  useEffect(() => {
    if (!focusBossSuggestionCaret.current) return;
    focusBossSuggestionCaret.current = false;
    const textarea = importantTextareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [importantPrompt]);

  const aiRules = useMemo(
    () =>
      rules.filter(
        (rule) => rule.domain === "mail" && rule.kind === "ai-filter",
      ),
    [rules],
  );
  const setupSurfaceAllowed =
    embedded || (!firstRunOnboardingOwnsSurface && !onboardingPreview);
  const firstRunPreferences = firstRunStage === "preferences";
  const firstRunSorting = firstRunStage === "sorting";
  const loadingSurfaceVisible =
    setupSurfaceAllowed &&
    forceOpen &&
    !firstRunPreferences &&
    (googleStatus.isLoading || (connected && jevAvailability.isLoading));
  const visible =
    setupSurfaceAllowed &&
    (firstRunPreferences
      ? forceOpen
      : firstRunSorting
        ? forceOpen &&
          !googleStatus.isLoading &&
          (!connected || !jevAvailability.isLoading)
        : connected &&
          !googleStatus.isLoading &&
          !jevAvailability.isLoading &&
          (forceOpen ||
            (!rulesLoading &&
              settings?.aiSetupCompleted !== true &&
              aiRules.length === 0)));

  useEffect(() => {
    const wasForceOpen = previousForceOpen.current;
    if (!forceOpen) previousForceOpen.current = false;
    if (!forceOpen || wasForceOpen) return;
    previousForceOpen.current = true;
    setStep(firstRunStage === "sorting" ? 3 : 0);
    setSelectedTags(new Set(["receipts", "github"]));
    setCustomTags([]);
    setImportantPrompt("");
    setArchivePrompt("");
    setBackfillRunId(null);
    setBackfillStartFailed(false);
    setBackfillReviewDestinations({});
    backfillStarted.current = false;
  }, [firstRunStage, forceOpen]);

  const complete = async () => {
    if (onboardingPreview) {
      onOpenChange?.(false);
      onComplete?.();
      return;
    }
    try {
      await updateSettings.mutateAsync({ aiSetupCompleted: true });
      onOpenChange?.(false);
      onComplete?.();
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

  const runBackfill = useCallback(
    async (
      ruleIds: string[],
      destinationsByRuleId: Record<string, ReviewDestination>,
    ) => {
      setBackfillStartFailed(false);
      try {
        const result = await startBackfill.mutateAsync({
          operation: "start",
          ruleIds: [...new Set(ruleIds)],
        });
        if (!("runId" in result) || !result.runId) {
          throw new Error("Backfill did not return a run ID");
        }
        setBackfillRunId(result.runId);
        setBackfillReviewDestinations(destinationsByRuleId);
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(PENDING_SETUP_RULE_IDS);
        }
      } catch {
        setBackfillStartFailed(true);
        backfillStarted.current = false;
      }
    },
    [startBackfill.mutateAsync],
  );

  useEffect(() => {
    if (
      !firstRunSorting ||
      onboardingPreview ||
      !connected ||
      !jevConfigured ||
      rulesLoading ||
      backfillStarted.current
    ) {
      return;
    }
    const ruleIds = pendingRuleIds;
    backfillStarted.current = true;
    const destinations = Object.fromEntries(
      aiRules.flatMap((rule) => {
        if (!ruleIds.includes(rule.id)) return [];
        const destination = reviewDestinationForRule(rule);
        return destination ? [[rule.id, destination] as const] : [];
      }),
    );
    if (ruleIds.length > 0) void runBackfill(ruleIds, destinations);
  }, [
    aiRules,
    connected,
    firstRunSorting,
    onboardingPreview,
    jevConfigured,
    pendingRuleIds,
    rulesLoading,
    runBackfill,
  ]);

  const savePreferences = async (includeArchive: boolean) => {
    if (onboardingPreview) {
      onComplete?.();
      return;
    }
    if (rulesLoading) return;
    setSaving(true);
    try {
      const ruleIds: string[] = [];
      const destinationsByRuleId: Record<string, ReviewDestination> = {};
      const includeRule = (rule: AutomationRule | null) => {
        if (!rule) return;
        ruleIds.push(rule.id);
        const destination = reviewDestinationForRule(rule);
        if (destination) destinationsByRuleId[rule.id] = destination;
      };

      for (const [id, nameKey, promptKey] of TAG_SUGGESTIONS) {
        if (!selectedTags.has(id)) continue;
        includeRule(
          await saveRule(t(promptKey), [
            { type: "label", labelName: t(nameKey) },
          ]),
        );
      }
      for (const customTag of customTags) {
        if (!customTag.name.trim() || !customTag.condition.trim()) continue;
        includeRule(
          await saveRule(customTag.condition, [
            { type: "label", labelName: customTag.name.trim() },
          ]),
        );
      }
      if (importantPrompt.trim()) {
        includeRule(
          await saveRule(importantPrompt, [
            { type: "label", labelName: AI_IMPORTANT_LABEL },
          ]),
        );
      }
      if (includeArchive && archivePrompt.trim()) {
        includeRule(await saveRule(archivePrompt, [{ type: "archive" }]));
      }

      const uniqueRuleIds = [...new Set(ruleIds)];
      if (firstRunPreferences) {
        window.sessionStorage.setItem(
          PENDING_SETUP_RULE_IDS,
          JSON.stringify(uniqueRuleIds),
        );
        await updateSettings.mutateAsync({ aiSetupCompleted: true });
        onComplete?.();
        return;
      }

      if (!jevConfigured) {
        await complete();
        return;
      }
      setBackfillReviewDestinations(destinationsByRuleId);
      if (uniqueRuleIds.length > 0) {
        backfillStarted.current = true;
        await runBackfill(uniqueRuleIds, destinationsByRuleId);
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

  const moveToStep = (nextStep: SetupStep) => {
    setStep(nextStep);
    if (firstRunPreferences) onStepChange?.(nextStep);
  };

  const skipCurrentStep = () => {
    if (step === 0) {
      setSelectedTags(new Set());
      setCustomTags([]);
      moveToStep(1);
    } else if (step === 1) {
      setImportantPrompt("");
      moveToStep(2);
    } else {
      void savePreferences(false);
    }
  };

  const importantLines = suggestionLines(importantPrompt);
  const archiveLines = suggestionLines(archivePrompt);
  const customTagIncomplete =
    step === 0 &&
    customTags.some((tag) => !tag.name.trim() || !tag.condition.trim());
  const headline =
    step === 0
      ? t("mail.sort.aiSetupTagsHeadline")
      : step === 1
        ? t("mail.sort.aiSetupImportantHeadline")
        : step === 2
          ? t("mail.sort.aiSetupSkipInboxHeadline")
          : t("mail.sort.aiSetupSortingHeadline");
  const description =
    step === 0
      ? t("mail.sort.aiSetupTagsDescription")
      : step === 1
        ? t("mail.sort.aiSetupImportantDescription")
        : step === 2
          ? t("mail.sort.aiSetupSkipInboxDescription")
          : t("mail.sort.aiSetupSortingDescription");
  const needsSetupToSort = firstRunSorting && (!connected || !jevConfigured);
  const displayHeadline =
    firstRunSorting && googleStatus.isError
      ? headline
      : needsSetupToSort
        ? connected
          ? t("mail.sort.aiSetupConnectJevHeadline")
          : t("mail.sort.aiSetupConnectGmailHeadline")
        : headline;
  const displayDescription =
    firstRunSorting && googleStatus.isError
      ? undefined
      : needsSetupToSort
        ? connected
          ? t("mail.sort.aiSetupConnectJevDescription")
          : t("mail.sort.aiSetupConnectGmailDescription")
        : description;
  const bossSuggestion = t("mail.sort.aiSetupImportantBoss");
  const bossSuggestionLabel = t("mail.sort.aiSetupImportantBossChip");
  const bossSuggestionPrefix = bossSuggestion.trimEnd();
  const bossSuggestionSelected = importantLines.some((line) =>
    line.startsWith(bossSuggestionPrefix),
  );
  const toggleBossSuggestion = () => {
    const lineIndex = importantLines.findIndex((line) =>
      line.startsWith(bossSuggestionPrefix),
    );
    if (lineIndex >= 0) {
      setImportantPrompt(
        importantLines.filter((_, index) => index !== lineIndex).join("\n"),
      );
      return;
    }
    const current = importantPrompt.trimEnd();
    focusBossSuggestionCaret.current = true;
    setImportantPrompt(
      current ? `${current}\n${bossSuggestion}` : bossSuggestion,
    );
  };
  const skipSorting = () => {
    if (onSkip) onSkip();
    else void complete();
  };
  const startRetry = () => {
    const ruleIds = pendingRuleIds;
    if (onboardingPreview || ruleIds.length === 0) return;
    backfillStarted.current = true;
    setBackfillRunId(null);
    const destinations = Object.fromEntries(
      aiRules.flatMap((rule) => {
        if (!ruleIds.includes(rule.id)) return [];
        const destination = reviewDestinationForRule(rule);
        return destination ? [[rule.id, destination] as const] : [];
      }),
    );
    void runBackfill(ruleIds, destinations);
  };
  const onAdjustRules = async () => {
    await complete();
    navigate("/settings?section=ai-filter");
  };
  const undoBackfill = async (undoToken: string) => {
    if (onboardingPreview || !backfillRunId) return;
    await startBackfill.mutateAsync({
      operation: "undo",
      runId: backfillRunId,
      undoToken,
    });
    await backfillStatus.refetch();
  };

  const stepFooter = firstRunPreferences ? (
    <>
      <div className="flex items-center gap-1">
        {step > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => moveToStep((step - 1) as SetupStep)}
            disabled={saving}
          >
            {t("mail.thread.back")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={skipCurrentStep}
          disabled={saving || (step === 2 && rulesLoading)}
        >
          {t("mail.sort.aiSetupSkip")}
        </Button>
      </div>
      <Button
        type="button"
        className={ONBOARDING_PRIMARY_BUTTON_CLASS}
        onClick={() =>
          step === 2
            ? void savePreferences(true)
            : moveToStep((step + 1) as SetupStep)
        }
        disabled={saving || (step === 0 && customTagIncomplete)}
        aria-busy={saving}
      >
        {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
        {t("mail.sort.aiSetupContinue")}
        {!saving ? <IconArrowRight className="size-4" /> : null}
      </Button>
    </>
  ) : firstRunSorting ? (
    needsSetupToSort ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={skipSorting}
      >
        {t("mail.sort.aiSetupSkip")}
      </Button>
    ) : (
      <>
        <div>
          {backfillStatus.data?.undoToken &&
          backfillStatus.data.status !== "undoing" &&
          backfillStatus.data.status !== "undone" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void undoBackfill(backfillStatus.data!.undoToken!)}
              disabled={startBackfill.isPending}
            >
              {t("mail.actions.undo")}
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void onAdjustRules()}
            disabled={updateSettings.isPending}
          >
            {t("mail.sort.aiSetupAdjustRules")}
          </Button>
          <Button
            type="button"
            className={ONBOARDING_PRIMARY_BUTTON_CLASS}
            onClick={() => void complete()}
            disabled={updateSettings.isPending}
          >
            {t("mail.sort.aiSetupDone")}
          </Button>
        </div>
      </>
    )
  ) : !embedded ? (
    <>
      <div className="flex items-center gap-1">
        {step > 0 && step < 3 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setStep((current) => (current - 1) as SetupStep)}
            disabled={saving}
          >
            {t("mail.thread.back")}
          </Button>
        ) : null}
        {step < 3 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={skipCurrentStep}
            disabled={saving || (step === 2 && rulesLoading)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("mail.sort.aiSetupSkip")}
          </Button>
        ) : null}
      </div>
      <Button
        type="button"
        className={ONBOARDING_PRIMARY_BUTTON_CLASS}
        onClick={() =>
          step === 3
            ? void complete()
            : step === 2
              ? void savePreferences(true)
              : setStep((current) => (current + 1) as SetupStep)
        }
        disabled={
          saving ||
          (step === 0 && customTagIncomplete) ||
          (step === 2 && rulesLoading)
        }
        aria-busy={saving}
      >
        {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
        {step === 3
          ? t("mail.sort.aiSetupDone")
          : step === 2
            ? t("mail.sort.aiSetupSortInbox")
            : t("mail.sort.aiSetupContinue")}
      </Button>
    </>
  ) : null;

  const stepContent = (
    <>
      {jevAvailability.isError && !firstRunPreferences ? (
        <div className="mb-5">
          <JevAvailabilityError
            onRetry={() => void jevAvailability.refetch()}
            retrying={jevAvailability.isFetching}
          />
        </div>
      ) : null}

      {step === 0 ? (
        <div className={cn(!firstRunPreferences && "mt-7", "space-y-2")}>
          <div className="max-h-[calc(100dvh-18.5rem)] space-y-2 overflow-y-auto">
            {TAG_SUGGESTIONS.map(([id, nameKey, promptKey]) => {
              const selected = selectedTags.has(id);
              const toggle = () =>
                setSelectedTags((current) => {
                  const next = new Set(current);
                  if (selected) next.delete(id);
                  else next.add(id);
                  return next;
                });
              return (
                <div
                  key={id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    toggle();
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {t(nameKey)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(promptKey)}
                    </p>
                  </div>
                  <Switch
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={toggle}
                    aria-label={t("mail.aiFilter.toggleInstruction", {
                      instruction: t(nameKey),
                    })}
                  />
                </div>
              );
            })}
            {customTags.map((tag) => (
              <div
                key={tag.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Input
                    value={tag.name}
                    autoFocus
                    onChange={(event) => {
                      const name = event.target.value;
                      setCustomTags((current) =>
                        current.map((item) =>
                          item.id === tag.id ? { ...item, name } : item,
                        ),
                      );
                    }}
                    placeholder={t("mail.sort.aiSetupCustomTabName")}
                    aria-label={t("mail.sort.aiSetupCustomTabName")}
                    className="h-5 border-0 bg-transparent p-0 text-sm font-medium shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Input
                    value={tag.condition}
                    onChange={(event) => {
                      const condition = event.target.value;
                      setCustomTags((current) =>
                        current.map((item) =>
                          item.id === tag.id ? { ...item, condition } : item,
                        ),
                      );
                    }}
                    placeholder={t("mail.sort.aiSetupCustomTabExample")}
                    aria-label={t("mail.sort.aiSetupCustomTabExample")}
                    className="h-4 border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  onClick={() =>
                    setCustomTags((current) =>
                      current.filter((item) => item.id !== tag.id),
                    )
                  }
                  aria-label={t("mail.accounts.remove")}
                >
                  <IconX className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              setCustomTags((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  condition: "",
                },
              ])
            }
          >
            <IconPlus className="size-4" />
            {t("mail.sort.aiSetupAddTab")}
          </Button>
        </div>
      ) : step === 1 ? (
        <div className={cn(!firstRunPreferences && "mt-7", "space-y-3")}>
          <Textarea
            ref={importantTextareaRef}
            value={importantPrompt}
            onChange={(event) => setImportantPrompt(event.target.value)}
            aria-label={headline}
            placeholder={t("mail.sort.aiSetupImportantExample")}
            className="min-h-24 resize-y"
          />
          <div className="flex flex-wrap gap-2">
            {IMPORTANT_SUGGESTIONS.map((key) => {
              const suggestion = t(key);
              const isBossSuggestion = key === "mail.sort.aiSetupImportantBoss";
              const selected = isBossSuggestion
                ? bossSuggestionSelected
                : importantLines.includes(suggestion);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    isBossSuggestion
                      ? toggleBossSuggestion()
                      : toggleSuggestion(
                          importantPrompt,
                          setImportantPrompt,
                          suggestion,
                        )
                  }
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                    selected
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {selected ? (
                    <IconCheck className="size-3.5" />
                  ) : (
                    <IconPlus className="size-3.5" />
                  )}
                  {isBossSuggestion ? bossSuggestionLabel : suggestion}
                </button>
              );
            })}
          </div>
        </div>
      ) : step === 2 ? (
        <div className={cn(!firstRunPreferences && "mt-7", "space-y-3")}>
          <Textarea
            value={archivePrompt}
            onChange={(event) => setArchivePrompt(event.target.value)}
            aria-label={headline}
            placeholder={t("mail.sort.aiSetupArchiveExample")}
            className="min-h-24 resize-y"
          />
          <div className="flex flex-wrap gap-2">
            {SKIP_INBOX_SUGGESTIONS.map((key) => {
              const suggestion = t(key);
              const selected = archiveLines.includes(suggestion);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    toggleSuggestion(
                      archivePrompt,
                      setArchivePrompt,
                      suggestion,
                    )
                  }
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                    selected
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {selected ? (
                    <IconCheck className="size-3.5" />
                  ) : (
                    <IconPlus className="size-3.5" />
                  )}
                  {suggestion}
                </button>
              );
            })}
          </div>
          {!firstRunPreferences && !jevConfigured ? (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <JevConnectionPrompt
                showHeading={false}
                onConnected={() => void jevAvailability.refetch()}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className={cn(!firstRunSorting && "mt-7", "space-y-5")}>
          {firstRunSorting && googleStatus.isError ? (
            <div className="flex items-center gap-3" role="alert">
              <p className="text-sm text-muted-foreground">
                {t("mail.sort.aiSetupGmailStatusFailed")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => void googleStatus.refetch()}
                disabled={googleStatus.isFetching}
              >
                {t("mail.sort.aiSetupRetry")}
              </Button>
            </div>
          ) : null}
          {firstRunSorting && googleStatus.isSuccess && !connected ? (
            googleStatus.data?.configured === true ||
            canOfferGoogleOAuthSetup ? (
              <GoogleConnectBanner variant="button" />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("mail.googleConnect.connectionNotConfigured")}
              </p>
            )
          ) : null}
          {firstRunSorting && connected && !jevConfigured ? (
            <JevConnectionPrompt
              showHeading={false}
              onConnected={() => void jevAvailability.refetch()}
            />
          ) : null}
          {needsSetupToSort ? null : (
            <SetupResults
              status={backfillStatus.data}
              reviewDestinationsByRuleId={backfillReviewDestinations}
              loading={
                startBackfill.isPending ||
                (backfillRunId !== null &&
                  !backfillStatus.data &&
                  (backfillStatus.isLoading || backfillStatus.isFetching))
              }
              hasRun={backfillRunId !== null || backfillStartFailed}
              failed={backfillStartFailed || backfillStatus.isError}
              onUndo={undoBackfill}
              onRetry={firstRunSorting ? startRetry : undefined}
              compactReviewLinks={firstRunSorting}
              showChatSuggestion={!firstRunSorting}
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
        </div>
      )}
    </>
  );

  if (loadingSurfaceVisible) {
    return (
      <SetupSurface
        embedded={embedded}
        visible={loadingSurfaceVisible}
        onClose={() => {
          onOpenChange?.(false);
          void complete();
        }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-6" aria-busy="true">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-28" />
        </div>
      </SetupSurface>
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
      <OnboardingStepLayout
        title={
          firstRunPreferences || firstRunSorting ? displayHeadline : undefined
        }
        description={
          firstRunPreferences || firstRunSorting
            ? displayDescription
            : undefined
        }
        header={
          !firstRunPreferences && !firstRunSorting && !embedded ? (
            <DialogHeader>
              <DialogTitle>{headline}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          ) : undefined
        }
        footer={stepFooter}
        className={
          firstRunPreferences || firstRunSorting
            ? undefined
            : "flex-1 justify-center"
        }
        contentClassName={
          firstRunPreferences || firstRunSorting ? "mt-7" : "mt-0"
        }
      >
        {stepContent}
      </OnboardingStepLayout>
    </SetupSurface>
  );
}
