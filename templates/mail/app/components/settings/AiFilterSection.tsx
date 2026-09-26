import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { AI_FILTER_LABEL, AI_FILTER_RULE_NAME } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import type { AiFilterBackfillStatus } from "@shared/ai-filter-backfill";
import type { AutomationAction, AutomationRule } from "@shared/types";
import {
  IconDotsVertical,
  IconGripVertical,
  IconPlus,
} from "@tabler/icons-react";
import type { DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { AiInboxSetup } from "@/components/onboarding/AiInboxSetup";
import { AiRulePromptField } from "@/components/settings/AiRulePromptField";
import {
  JevAvailabilityError,
  JevConnectionPrompt,
} from "@/components/settings/JevConnectionPrompt";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAiFilter,
  useManageAiFilterBackfill,
  useManageAiFilter,
  useRecentAiFilterBackfills,
  latestAiFilterDecisions,
} from "@/hooks/use-ai-filter";
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/hooks/use-automations";
import { useLabels, useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import {
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  normalizedAiFilterLabelId,
  type AiFilterRuleMode,
} from "@shared/ai-filter-rules";

type RuleMode = AiFilterRuleMode;

const RULE_MODES: RuleMode[] = ["important", "tag", "filtered", "archive"];

function actionsForMode(mode: RuleMode, tagName: string): AutomationAction[] {
  if (mode === "important") {
    return [{ type: "label", labelName: AI_IMPORTANT_LABEL }];
  }
  if (mode === "tag") return [{ type: "label", labelName: tagName }];
  if (mode === "filtered") {
    return [{ type: "label", labelName: AI_FILTER_LABEL }, { type: "archive" }];
  }
  return [{ type: "archive" }];
}

function reviewHrefForRule(rule: AutomationRule): string | null {
  const mode = aiFilterRuleMode(rule);
  if (mode === "filtered") {
    return `/inbox?label=${encodeURIComponent(AI_FILTER_LABEL)}`;
  }
  if (mode === "important") {
    return `/inbox?label=${encodeURIComponent(AI_IMPORTANT_LABEL)}`;
  }
  if (mode === "tag") {
    return `/inbox?label=${encodeURIComponent(aiFilterRuleLabelName(rule))}`;
  }
  return mode === "archive" ? "/archive" : null;
}

function ruleName(mode: RuleMode, condition: string) {
  const prefix =
    mode === "filtered" ? "spam" : mode === "archive" ? "archive" : mode;
  return `AI ${prefix}: ${condition.slice(0, 72)}`;
}

function RuleRow({
  rule,
  mode,
  editing,
  editDisabled,
  toggleDisabled,
  onEdit,
  onSave,
  onCancel,
  onAskJev,
  onToggle,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  rule: AutomationRule;
  mode: RuleMode;
  editing: boolean;
  editDisabled: boolean;
  toggleDisabled: boolean;
  onEdit: () => void;
  onSave: (condition: string, tagName: string) => void;
  onCancel: () => void;
  onAskJev: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const t = useT();
  const [condition, setCondition] = useState(rule.condition);
  const [tagName, setTagName] = useState(aiFilterRuleLabelName(rule));

  useEffect(() => {
    setCondition(rule.condition);
    setTagName(aiFilterRuleLabelName(rule));
  }, [rule]);

  return (
    <div
      draggable={mode === "tag" && !editing && !editDisabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="group border-b border-border/40 last:border-0"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {mode === "tag" && (
          <IconGripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {mode === "tag" ? aiFilterRuleLabelName(rule) : rule.condition}
          </p>
          {mode === "tag" && (
            <p className="truncate text-xs text-muted-foreground">
              {rule.condition}
            </p>
          )}
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={onToggle}
          aria-label={t("mail.aiFilter.toggleInstruction", {
            instruction: rule.condition,
          })}
          disabled={toggleDisabled}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t("mail.toolbar.menu")}
            >
              <IconDotsVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit} disabled={editDisabled}>
              {t("settings.editRule")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAskJev}>
              {t("mail.aiFilter.askJev")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              {t("settings.deleteRule")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing && (
        <form
          className="space-y-3 border-t border-border/40 bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(condition, tagName);
          }}
        >
          {mode === "tag" && (
            <div className="space-y-1.5">
              <label
                htmlFor={`ai-filter-tag-${rule.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {t("mail.aiFilter.tagNamePlaceholder")}
              </label>
              <Input
                id={`ai-filter-tag-${rule.id}`}
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                disabled={editDisabled}
              />
            </div>
          )}
          <AiRulePromptField
            value={condition}
            onChange={setCondition}
            disabled={editDisabled}
            label={t("mail.aiFilter.instructionsTitle")}
            placeholder={t("mail.aiFilter.instructionPlaceholder")}
            className="min-h-20 resize-y text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("settings.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                editDisabled ||
                !condition.trim() ||
                (mode === "tag" && !tagName.trim())
              }
            >
              {t("settings.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function RuleBackfillStatus({
  ruleId,
  status,
  loading,
  starting,
  failed,
  undoing,
  reviewHref,
  onUndo,
}: {
  ruleId: string;
  status: AiFilterBackfillStatus | undefined;
  loading: boolean;
  starting: boolean;
  failed: boolean;
  undoing: boolean;
  reviewHref: string | null;
  onUndo: (runId: string, undoToken: string) => void;
}) {
  const t = useT();
  const working =
    starting ||
    loading ||
    status?.status === "queued" ||
    status?.status === "running" ||
    status?.status === "undoing" ||
    undoing;

  if (!starting && !loading && !failed && !status && !undoing) return null;

  if (working) {
    const percent =
      status && status.totalThreads > 0
        ? Math.min(
            100,
            Math.round((status.processedThreads / status.totalThreads) * 100),
          )
        : 0;
    const message =
      undoing || status?.status === "undoing"
        ? t("mail.aiFilter.ruleBackfillUndoing")
        : starting || loading
          ? t("mail.aiFilter.ruleBackfillStarting")
          : t("mail.aiFilter.ruleBackfillProgress", {
              processed: status?.processedThreads ?? 0,
              total: status?.totalThreads ?? 0,
            });

    return (
      <div className="space-y-1.5 border-t border-border/40 px-3 py-2.5">
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={message}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-full rounded-full bg-primary transition-[width] duration-300 ${status?.totalThreads ? "" : "w-1/3 animate-pulse"}`}
            style={status?.totalThreads ? { width: `${percent}%` } : undefined}
          />
        </div>
      </div>
    );
  }

  if (failed || status?.status === "failed") {
    return (
      <p
        role="alert"
        className="border-t border-border/40 px-3 py-2.5 text-xs text-destructive"
      >
        {t("mail.aiFilter.ruleBackfillFailed")}
      </p>
    );
  }
  if (!status) return null;
  if (status.status === "undone") {
    return (
      <p className="border-t border-border/40 px-3 py-2.5 text-xs text-muted-foreground">
        {t("mail.aiFilter.ruleBackfillUndoComplete", {
          count: status.restoredThreads ?? 0,
        })}
      </p>
    );
  }

  const ruleStatus = status.perRule.find((item) => item.ruleId === ruleId);
  if (!ruleStatus) {
    return status.failedThreads > 0 ? (
      <p
        role="alert"
        className="border-t border-border/40 px-3 py-2.5 text-xs text-destructive"
      >
        {t("mail.aiFilter.ruleBackfillPartialFailure", {
          count: status.failedThreads,
        })}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          {ruleStatus.matchedCount > 0
            ? t("mail.aiFilter.ruleBackfillMatches", {
                count: ruleStatus.matchedCount,
              })
            : t("mail.aiFilter.ruleBackfillNoMatches")}
        </p>
        <div className="flex items-center gap-1">
          {reviewHref && ruleStatus.matchedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              asChild
            >
              <Link to={reviewHref}>
                {t("mail.aiFilter.ruleBackfillReview")}
              </Link>
            </Button>
          )}
          {status.undoToken && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onUndo(status.runId, status.undoToken!)}
              disabled={undoing}
            >
              {t("mail.actions.undo")}
            </Button>
          )}
        </div>
      </div>
      {status.failedThreads > 0 && (
        <p role="alert" className="text-xs text-destructive">
          {t("mail.aiFilter.ruleBackfillPartialFailure", {
            count: status.failedThreads,
          })}
        </p>
      )}
      {ruleStatus.previews.length > 0 && (
        <ul className="divide-y divide-border/40">
          {ruleStatus.previews.slice(0, 3).map((preview) => (
            <li
              key={preview.id}
              className="min-w-0 py-1.5 first:pt-0 last:pb-0"
            >
              <p className="truncate text-xs text-foreground">
                {preview.subject || t("mail.aiFilter.noSubject")}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {preview.from || t("mail.aiFilter.unknownSender")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiFilterSection() {
  const t = useT();
  const navigate = useNavigate();
  const { data: state, isLoading: filterLoading } = useAiFilter();
  const { data: rules = [], isLoading: rulesLoading } = useAutomations();
  const { data: settings } = useSettings();
  const { data: labels = [] } = useLabels();
  const googleStatus = useGoogleAuthStatus();
  const jevAvailability = useActionQuery(
    "get-jev-availability",
    {},
    {
      staleTime: 0,
      // request-storm-allow: the shared status query revalidates API-key setup when its settings tab returns.
      refetchOnWindowFocus: true,
    },
  );
  const jevConfigured =
    !jevAvailability.isError && jevAvailability.data?.configured === true;
  const updateSettings = useManageAiFilter();
  const manageBackfill = useManageAiFilterBackfill();
  const updatePreferences = useUpdateSettings();
  const createRule = useCreateAutomation();
  const updateRule = useUpdateAutomation();
  const deleteRule = useDeleteAutomation();
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRuleMode, setNewRuleMode] = useState<RuleMode>("important");
  const [newRuleCondition, setNewRuleCondition] = useState("");
  const [newRuleTagName, setNewRuleTagName] = useState("");
  const [savingNewRule, setSavingNewRule] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("92");
  const [setupAgainOpen, setSetupAgainOpen] = useState(false);
  const [queueingBackfillRuleId, setQueueingBackfillRuleId] = useState<
    string | null
  >(null);
  const [undoingBackfill, setUndoingBackfill] = useState(false);
  const backfillRequestSequence = useRef(0);
  const backfillToastRules = useRef(new Map<string, string>());
  const recentBackfills = useRecentAiFilterBackfills();

  const instructions = useMemo(
    () =>
      rules.filter(
        (rule) =>
          rule.domain === "mail" &&
          rule.kind === "ai-filter" &&
          rule.name !== AI_FILTER_RULE_NAME &&
          aiFilterRuleMode(rule) !== null,
      ),
    [rules],
  );
  const labelIdForName = (name: string) =>
    labels.find(
      (label) =>
        normalizedAiFilterLabelId(label.name) ===
        normalizedAiFilterLabelId(name),
    )?.id ?? normalizedAiFilterLabelId(name);
  const sortedRules = useMemo(() => {
    const pinned = settings?.pinnedLabels ?? [];
    const rank = (rule: AutomationRule) => {
      if (aiFilterRuleMode(rule) !== "tag") return 0;
      const name = aiFilterRuleLabelName(rule);
      const index = Math.min(
        ...[name, labelIdForName(name)]
          .map((id) => pinned.indexOf(id))
          .filter((value) => value >= 0),
      );
      return Number.isFinite(index) ? index : pinned.length;
    };
    return [...instructions].sort((a, b) => rank(a) - rank(b));
  }, [instructions, labels, settings?.pinnedLabels]);
  const rulesByMode = useMemo(
    () =>
      Object.fromEntries(
        RULE_MODES.map((mode) => [
          mode,
          sortedRules.filter((rule) => aiFilterRuleMode(rule) === mode),
        ]),
      ) as Record<RuleMode, AutomationRule[]>,
    [sortedRules],
  );

  useEffect(() => {
    if (state) {
      setThresholdDraft(String(Math.round(state.autoFilterThreshold * 100)));
    }
  }, [state?.autoFilterThreshold]);

  const updateAiSettings = (
    next:
      | { enabled: boolean }
      | { autoFilter: boolean }
      | { autoFilterThreshold: number },
  ) => {
    updateSettings.mutate(
      { mode: "settings", settings: next },
      {
        onError: (error) =>
          toast.error(
            actionErrorMessage(error) ?? t("mail.aiFilter.settingsFailed"),
          ),
      },
    );
  };

  const saveThreshold = () => {
    if (!state) return;
    const percent = Number(thresholdDraft);
    if (!Number.isInteger(percent) || percent < 50 || percent > 100) {
      setThresholdDraft(String(Math.round(state.autoFilterThreshold * 100)));
      return;
    }
    const value = percent / 100;
    if (value !== state.autoFilterThreshold) {
      updateSettings.mutate(
        { mode: "settings", settings: { autoFilterThreshold: value } },
        {
          onError: (error) => {
            setThresholdDraft(
              String(Math.round(state.autoFilterThreshold * 100)),
            );
            toast.error(
              actionErrorMessage(error) ?? t("mail.aiFilter.settingsFailed"),
            );
          },
        },
      );
    }
  };

  const modeLabel = (mode: RuleMode) => {
    if (mode === "important") return t("mail.aiFilter.importantMode");
    if (mode === "tag") return t("mail.aiFilter.aiTagsTitle");
    if (mode === "filtered") return t("mail.aiFilter.filteredMode");
    return t("mail.aiFilter.autoArchiveMode");
  };

  const askJevAboutRule = (rule: AutomationRule) => {
    const mode = aiFilterRuleMode(rule);
    if (!mode) return;
    sendToAgentChat({
      message: t("mail.aiFilter.askJevPrompt", {
        condition: rule.condition,
      }),
      context: JSON.stringify({
        ruleId: rule.id,
        mode,
        condition: rule.condition,
      }),
      submit: false,
      openSidebar: true,
    });
  };

  const queueRuleBackfill = async (ruleId: string) => {
    const requestSequence = ++backfillRequestSequence.current;
    setQueueingBackfillRuleId(ruleId);
    try {
      const result = await manageBackfill.mutateAsync({
        operation: "start",
        ruleIds: [ruleId],
      });
      if ("runId" in result)
        backfillToastRules.current.set(result.runId, ruleId);
      if (requestSequence === backfillRequestSequence.current) {
        await recentBackfills.refetch();
      }
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.ruleBackfillFailed"),
      );
    } finally {
      if (requestSequence === backfillRequestSequence.current) {
        setQueueingBackfillRuleId(null);
      }
    }
  };

  const undoRuleBackfill = async (runId: string, undoToken: string) => {
    if (undoingBackfill) return;
    setUndoingBackfill(true);
    try {
      await manageBackfill.mutateAsync({
        operation: "undo",
        runId,
        undoToken,
      });
      await recentBackfills.refetch();
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.ruleBackfillFailed"),
      );
    } finally {
      setUndoingBackfill(false);
    }
  };

  useEffect(() => {
    for (const run of recentBackfills.data ?? []) {
      const ruleId = backfillToastRules.current.get(run.runId);
      if (!ruleId || ["queued", "running", "undoing"].includes(run.status)) {
        continue;
      }
      backfillToastRules.current.delete(run.runId);
      const rule = instructions.find((item) => item.id === ruleId);
      const progress = run.perRule.find((item) => item.ruleId === ruleId);
      if (run.status === "failed" || !rule || !progress) {
        if (run.status === "failed") {
          toast.error(t("mail.aiFilter.ruleBackfillFailed"));
        }
        continue;
      }
      if (run.status !== "completed") continue;

      const matched = progress.matchedCount;
      const reviewHref = matched > 0 ? reviewHrefForRule(rule) : null;
      toast(
        matched > 0
          ? t("mail.aiFilter.ruleBackfillMatches", { count: matched })
          : t("mail.aiFilter.ruleBackfillNoMatches"),
        {
          duration: 10_000,
          ...(reviewHref
            ? {
                action: {
                  label: t("mail.aiFilter.ruleBackfillReview"),
                  onClick: () => void navigate(reviewHref),
                },
              }
            : {}),
          ...(run.undoToken
            ? {
                cancel: {
                  label: t("mail.actions.undo"),
                  onClick: () =>
                    void undoRuleBackfill(run.runId, run.undoToken!),
                },
              }
            : {}),
        },
      );
    }
  }, [instructions, navigate, recentBackfills.data, t]);

  const saveNewRule = async () => {
    if (!jevConfigured || savingNewRule) return;
    const condition = newRuleCondition.trim();
    const tagName = newRuleTagName.trim();
    if (!condition || (newRuleMode === "tag" && !tagName)) return;
    setSavingNewRule(true);
    try {
      const created = await createRule.mutateAsync({
        name: ruleName(newRuleMode, condition),
        condition,
        actions: actionsForMode(newRuleMode, tagName),
        kind: "ai-filter",
        domain: "mail",
      });
      setNewRuleOpen(false);
      setNewRuleCondition("");
      setNewRuleTagName("");
      toast(t("mail.aiFilter.ruleAdded"));
      void queueRuleBackfill(created.id);
      return created;
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.instructionFailed"),
      );
    } finally {
      setSavingNewRule(false);
    }
  };

  const saveRule = async (
    rule: AutomationRule,
    conditionDraft: string,
    tagNameDraft: string,
  ) => {
    const mode = aiFilterRuleMode(rule);
    if (!mode || !jevConfigured) return;
    const condition = conditionDraft.trim();
    const tagName = tagNameDraft.trim();
    if (!condition || (mode === "tag" && !tagName)) return;
    const oldTagName = aiFilterRuleLabelName(rule);
    const changed =
      condition !== rule.condition ||
      (mode === "tag" && tagName !== oldTagName);
    if (!changed) {
      setEditingRuleId(null);
      return;
    }
    try {
      await updateRule.mutateAsync({
        id: rule.id,
        name: ruleName(mode, condition),
        condition,
        actions: actionsForMode(mode, tagName),
      });
      setEditingRuleId(null);
      void queueRuleBackfill(rule.id);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.instructionFailed"),
      );
    }
  };

  const toggleRule = (rule: AutomationRule, enabled: boolean) => {
    updateRule.mutate(
      { id: rule.id, enabled },
      {
        onSuccess: () => {
          if (enabled) void queueRuleBackfill(rule.id);
        },
        onError: (error) =>
          toast.error(
            actionErrorMessage(error) ?? t("mail.aiFilter.instructionFailed"),
          ),
      },
    );
  };

  const removeRule = async (rule: AutomationRule) => {
    try {
      await deleteRule.mutateAsync(rule.id);
      setEditingRuleId((current) => (current === rule.id ? null : current));
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.instructionFailed"),
      );
    }
  };

  const reorderTags = async (draggedId: string, targetId: string) => {
    if (!jevConfigured || draggedId === targetId) return;
    const tagRules = rulesByMode.tag;
    const orderedNames = tagRules.map((rule) => aiFilterRuleLabelName(rule));
    const from = tagRules.findIndex((rule) => rule.id === draggedId);
    const to = tagRules.findIndex((rule) => rule.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = orderedNames.splice(from, 1);
    orderedNames.splice(to, 0, moved);
    const current = settings?.pinnedLabels ?? [];
    const tagIds = new Set(
      tagRules.map((rule) => labelIdForName(aiFilterRuleLabelName(rule))),
    );
    let nextIndex = 0;
    const reordered = current.map((id) =>
      tagIds.has(id) ? labelIdForName(orderedNames[nextIndex++]) : id,
    );
    while (nextIndex < orderedNames.length) {
      reordered.push(labelIdForName(orderedNames[nextIndex++]));
    }
    try {
      await updatePreferences.mutateAsync({ pinnedLabels: reordered });
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.settingsFailed"),
      );
    }
  };

  if (filterLoading || rulesLoading || !state) {
    return <Skeleton className="h-72 w-full max-w-[720px]" />;
  }

  const decisions = latestAiFilterDecisions(state).slice(0, 5);

  return (
    <>
      <div className="max-w-[720px] space-y-7 pb-10">
        <div className="flex items-center justify-between border-b border-border/50 pb-4">
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("mail.aiFilter.triageTitle")}
          </h2>
          <Switch
            checked={state.enabled}
            onCheckedChange={(enabled) => updateAiSettings({ enabled })}
            aria-label={t("mail.aiFilter.toggle")}
            disabled={!jevConfigured && !state.enabled}
          />
        </div>

        {jevAvailability.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : jevAvailability.isError ? (
          <JevAvailabilityError
            onRetry={() => void jevAvailability.refetch()}
            retrying={jevAvailability.isFetching}
          />
        ) : !jevConfigured ? (
          <JevConnectionPrompt
            onConnected={() => void jevAvailability.refetch()}
          />
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">
              {t("mail.aiFilter.rulesTitle")}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!jevConfigured}
              onClick={() => setNewRuleOpen((open) => !open)}
            >
              <IconPlus className="size-3.5" />
              {t("mail.aiFilter.newRule")}
            </Button>
          </div>

          {newRuleOpen && (
            <form
              className="space-y-3 rounded-lg border border-border/50 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveNewRule();
              }}
            >
              <div
                className="flex flex-wrap gap-1 rounded-lg border border-border/50 p-1"
                role="group"
                aria-label={t("mail.aiFilter.rulesTitle")}
              >
                {RULE_MODES.map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={newRuleMode === mode ? "secondary" : "ghost"}
                    aria-pressed={newRuleMode === mode}
                    disabled={!jevConfigured || savingNewRule}
                    onClick={() => setNewRuleMode(mode)}
                  >
                    {modeLabel(mode)}
                  </Button>
                ))}
              </div>
              {newRuleMode === "tag" && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="new-ai-filter-tag"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("mail.aiFilter.tagNamePlaceholder")}
                  </label>
                  <Input
                    id="new-ai-filter-tag"
                    value={newRuleTagName}
                    onChange={(event) => setNewRuleTagName(event.target.value)}
                    disabled={!jevConfigured || savingNewRule}
                  />
                </div>
              )}
              <AiRulePromptField
                value={newRuleCondition}
                onChange={setNewRuleCondition}
                disabled={!jevConfigured || savingNewRule}
                label={t("mail.aiFilter.instructionsTitle")}
                placeholder={t("mail.aiFilter.instructionPlaceholder")}
                className="min-h-20 resize-y text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setNewRuleOpen(false)}
                  disabled={savingNewRule}
                >
                  {t("settings.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !jevConfigured ||
                    savingNewRule ||
                    !newRuleCondition.trim() ||
                    (newRuleMode === "tag" && !newRuleTagName.trim())
                  }
                >
                  {t("mail.aiFilter.addInstruction")}
                </Button>
              </div>
            </form>
          )}

          {instructions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("mail.aiFilter.noInstructions")}
            </p>
          )}

          <div className="space-y-5">
            {RULE_MODES.map((mode) => {
              const modeRules = rulesByMode[mode];
              if (mode !== "filtered" && modeRules.length === 0) return null;
              return (
                <section key={mode} className="space-y-2">
                  <h4 className="text-[13px] font-semibold text-foreground">
                    {modeLabel(mode)}
                  </h4>
                  {modeRules.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-border/50">
                      {modeRules.map((rule) => {
                        const status = recentBackfills.data?.find((run) =>
                          run.perRule.some(
                            (progress) => progress.ruleId === rule.id,
                          ),
                        );
                        return (
                          <div key={rule.id} className="overflow-hidden">
                            <RuleRow
                              rule={rule}
                              mode={mode}
                              editing={editingRuleId === rule.id}
                              editDisabled={!jevConfigured}
                              toggleDisabled={!jevConfigured && !rule.enabled}
                              onEdit={() => setEditingRuleId(rule.id)}
                              onSave={(condition, tagName) =>
                                void saveRule(rule, condition, tagName)
                              }
                              onCancel={() => setEditingRuleId(null)}
                              onAskJev={() => askJevAboutRule(rule)}
                              onToggle={(enabled) => toggleRule(rule, enabled)}
                              onDelete={() => void removeRule(rule)}
                              onDragStart={(event) =>
                                event.dataTransfer.setData(
                                  "text/plain",
                                  rule.id,
                                )
                              }
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                void reorderTags(
                                  event.dataTransfer.getData("text/plain"),
                                  rule.id,
                                );
                              }}
                            />
                            {(queueingBackfillRuleId === rule.id || status) && (
                              <RuleBackfillStatus
                                ruleId={rule.id}
                                status={status}
                                loading={!status && recentBackfills.isLoading}
                                starting={queueingBackfillRuleId === rule.id}
                                failed={!status && recentBackfills.isError}
                                undoing={undoingBackfill}
                                reviewHref={reviewHrefForRule(rule)}
                                onUndo={(runId, undoToken) =>
                                  void undoRuleBackfill(runId, undoToken)
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {mode === "filtered" && (
                    <details className="rounded-lg border border-border/50">
                      <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-foreground">
                        {t("mail.aiFilter.manageSettings")}
                      </summary>
                      <div className="space-y-4 border-t border-border/40 p-3">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-medium text-foreground">
                            {t("mail.aiFilter.autoFilterTitle")}
                          </span>
                          <Switch
                            checked={state.autoFilter}
                            onCheckedChange={(autoFilter) =>
                              updateAiSettings({ autoFilter })
                            }
                            aria-label={t("mail.aiFilter.autoFilterToggle")}
                            disabled={!jevConfigured}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label
                            htmlFor="ai-filter-auto-threshold"
                            className="text-sm text-foreground"
                          >
                            {t("mail.aiFilter.thresholdLabel")}
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              id="ai-filter-auto-threshold"
                              type="number"
                              inputMode="numeric"
                              min={50}
                              max={100}
                              step={1}
                              value={thresholdDraft}
                              onChange={(event) =>
                                setThresholdDraft(event.target.value)
                              }
                              onBlur={saveThreshold}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              aria-label={t("mail.aiFilter.thresholdLabel")}
                              className="w-20"
                              disabled={!jevConfigured}
                            />
                            <span className="text-sm text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                        <div className="space-y-2 border-t border-border/40 pt-3">
                          <div className="flex items-center justify-between gap-3">
                            <h5 className="text-sm font-medium text-foreground">
                              {t("mail.aiFilter.activityTitle")}
                            </h5>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              asChild
                            >
                              <Link
                                to={`/inbox?label=${encodeURIComponent(state.labelName)}`}
                              >
                                {t("mail.aiFilter.reviewLabel")}
                              </Link>
                            </Button>
                          </div>
                          {decisions.length > 0 ? (
                            <ul className="divide-y divide-border/40">
                              {decisions.map((decision) => (
                                <li
                                  key={decision.id}
                                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm text-foreground">
                                      {decision.subject ||
                                        t("mail.aiFilter.noSubject")}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {decision.sender ||
                                        t("mail.aiFilter.unknownSender")}
                                    </p>
                                    {decision.reason && (
                                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {decision.reason}
                                      </p>
                                    )}
                                  </div>
                                  <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                                    {decision.disposition === "filtered"
                                      ? t("mail.aiFilter.filterButton")
                                      : decision.disposition === "kept"
                                        ? t("mail.aiFilter.keepButton")
                                        : t("mail.aiFilter.suggestionCount", {
                                            count: 1,
                                          })}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {t("mail.aiFilter.noActivity")}
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        </section>

        {(googleStatus.data?.accounts.length ?? 0) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => setSetupAgainOpen(true)}
          >
            {t("mail.sort.aiSetupRunAgain")}
          </Button>
        )}
      </div>
      <AiInboxSetup
        forceOpen={setupAgainOpen}
        onOpenChange={setSetupAgainOpen}
      />
    </>
  );
}
