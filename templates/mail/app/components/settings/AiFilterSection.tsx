import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AI_FILTER_LABEL, AI_FILTER_RULE_NAME } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import type { AutomationAction, AutomationRule } from "@shared/types";
import {
  IconGripVertical,
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AiInboxSetup,
  TAG_SUGGESTIONS,
} from "@/components/onboarding/AiInboxSetup";
import { AiRulePromptField } from "@/components/settings/AiRulePromptField";
import {
  JevAvailabilityError,
  JevConnectionPrompt,
} from "@/components/settings/JevConnectionPrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useManageAiFilter, useAiFilter } from "@/hooks/use-ai-filter";
import {
  useAutomations,
  useConsolidateAiFilterRules,
  useCreateAutomation,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/hooks/use-automations";
import { useLabels, useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";

type RuleMode = "tag" | "important" | "archive" | "spam";
type PromptMode = Exclude<RuleMode, "tag">;

function makeAggregateError(errors: unknown[], message: string) {
  const error = new Error(message);
  error.name = "AggregateError";
  return Object.assign(error, { errors });
}

const PROMPT_MODES: PromptMode[] = ["important", "archive", "spam"];

const labelForRule = (rule: AutomationRule) => {
  const action = rule.actions.find((item) => item.type === "label");
  return action?.type === "label" ? action.labelName : "";
};

const normalizedLabelId = (labelName: string) =>
  labelName.toLocaleLowerCase().replace(/_/g, " ");

function ruleMode(rule: Pick<AutomationRule, "actions">): RuleMode {
  if (
    rule.actions.some(
      (action) =>
        action.type === "label" && action.labelName === AI_FILTER_LABEL,
    )
  ) {
    return "spam";
  }
  if (rule.actions.some((action) => action.type === "archive"))
    return "archive";
  if (
    rule.actions.some(
      (action) =>
        action.type === "label" && action.labelName === AI_IMPORTANT_LABEL,
    )
  ) {
    return "important";
  }
  return "tag";
}

function actionsForMode(mode: PromptMode): AutomationAction[] {
  if (mode === "important") {
    return [{ type: "label", labelName: AI_IMPORTANT_LABEL }];
  }
  if (mode === "archive") return [{ type: "archive" }];
  return [{ type: "label", labelName: AI_FILTER_LABEL }, { type: "archive" }];
}

function promptForRules(rules: AutomationRule[]) {
  return rules
    .map((rule) => rule.condition.trim())
    .filter(Boolean)
    .join("\n");
}

function AiTagRow({
  rule,
  expanded,
  disabled,
  onToggle,
  onSave,
  onDelete,
  onDrop,
}: {
  rule: AutomationRule;
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSave: (rule: AutomationRule, name: string, condition: string) => void;
  onDelete: (rule: AutomationRule) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, ruleId: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(labelForRule(rule));
  const [condition, setCondition] = useState(rule.condition);

  useEffect(() => {
    setName(labelForRule(rule));
    setCondition(rule.condition);
  }, [rule]);

  const save = () => onSave(rule, name, condition);

  return (
    <div
      draggable={!expanded && !disabled}
      onDragStart={(event) => {
        if (!disabled) event.dataTransfer.setData("text/plain", rule.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, rule.id)}
      className="group border-b border-border/40 last:border-0"
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <IconGripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        <button
          type="button"
          className="grid min-w-0 flex-1 grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-left"
          aria-expanded={expanded}
          disabled={disabled}
          onClick={onToggle}
        >
          <span className="truncate text-sm font-medium text-foreground">
            {labelForRule(rule)}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {rule.condition}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("mail.aiFilter.deleteInstruction")}
          onClick={() => onDelete(rule)}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border/40 bg-muted/20 p-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            disabled={disabled}
            aria-label={t("mail.aiFilter.tagNamePlaceholder")}
            placeholder={t("mail.aiFilter.tagNamePlaceholder")}
          />
          <AiRulePromptField
            value={condition}
            onChange={setCondition}
            onBlur={save}
            disabled={disabled}
            label={t("mail.aiFilter.tagPlaceholder")}
            placeholder={t("mail.aiFilter.tagPlaceholder")}
          />
        </div>
      )}
    </div>
  );
}

export function AiFilterSection() {
  const t = useT();
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
  const jevUnavailable =
    !jevAvailability.isLoading &&
    !jevAvailability.isError &&
    jevAvailability.data?.configured === false;
  const updateSettings = useManageAiFilter();
  const updatePreferences = useUpdateSettings();
  const consolidateAiFilterRules = useConsolidateAiFilterRules();
  const createRule = useCreateAutomation();
  const updateRule = useUpdateAutomation();
  const deleteRule = useDeleteAutomation();
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagPrompt, setNewTagPrompt] = useState("");
  const [savingNewTag, setSavingNewTag] = useState(false);
  const [savingSuggestedTag, setSavingSuggestedTag] = useState<string | null>(
    null,
  );
  const [setupAgainOpen, setSetupAgainOpen] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<PromptMode, string>>({
    important: "",
    archive: "",
    spam: "",
  });

  const instructions = useMemo(
    () =>
      rules.filter(
        (rule) =>
          rule.domain === "mail" &&
          rule.kind === "ai-filter" &&
          rule.name !== AI_FILTER_RULE_NAME,
      ),
    [rules],
  );
  const labelIdForName = (name: string) =>
    labels.find(
      (label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )?.id ?? normalizedLabelId(name);
  const promptRules = useMemo(
    () =>
      Object.fromEntries(
        PROMPT_MODES.map((mode) => [
          mode,
          instructions.filter(
            (rule) => rule.enabled && ruleMode(rule) === mode,
          ),
        ]),
      ) as Record<PromptMode, AutomationRule[]>,
    [instructions],
  );
  const tagRules = useMemo(() => {
    const pinned = settings?.pinnedLabels ?? [];
    const rank = (rule: AutomationRule) => {
      const name = labelForRule(rule);
      const labelId = labelIdForName(name);
      const actionId = name;
      const index = Math.min(
        ...[labelId, actionId]
          .map((id) => pinned.indexOf(id))
          .filter((value) => value >= 0),
      );
      return Number.isFinite(index) ? index : pinned.length;
    };
    return [...instructions]
      .filter((rule) => ruleMode(rule) === "tag")
      .sort((a, b) => rank(a) - rank(b));
  }, [instructions, labels, settings?.pinnedLabels]);

  useEffect(() => {
    setPromptDrafts({
      important: promptForRules(promptRules.important),
      archive: promptForRules(promptRules.archive),
      spam: promptForRules(promptRules.spam),
    });
  }, [promptRules]);

  const updateAiSettings = (enabled: boolean) => {
    if (enabled && !jevConfigured) return;
    updateSettings.mutate(
      { mode: "settings", settings: { enabled } },
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

  const savePrompt = async (mode: PromptMode) => {
    const condition = promptDrafts[mode].trim();
    const existing = promptRules[mode];
    if (condition === promptForRules(existing)) return;
    if (!jevConfigured && condition) {
      setPromptDrafts((drafts) => ({
        ...drafts,
        [mode]: promptForRules(existing),
      }));
      return;
    }
    const actions = actionsForMode(mode);

    const restoreRules = async (rulesToRestore: AutomationRule[]) => {
      const errors: unknown[] = [];
      for (const rule of rulesToRestore) {
        try {
          const restored = await createRule.mutateAsync({
            name: rule.name,
            condition: rule.condition,
            actions: rule.actions,
            kind: rule.kind,
            domain: rule.domain,
          });
          if (!rule.enabled) {
            await updateRule.mutateAsync({ id: restored.id, enabled: false });
          }
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) {
        throw makeAggregateError(
          errors,
          errors[0] instanceof Error
            ? errors[0].message
            : t("mail.aiFilter.instructionFailed"),
        );
      }
    };
    try {
      if (!condition) {
        const removed: AutomationRule[] = [];
        try {
          for (const rule of existing) {
            await deleteRule.mutateAsync(rule.id);
            removed.push(rule);
          }
        } catch (error) {
          try {
            await restoreRules(removed);
          } catch (restoreError) {
            throw makeAggregateError(
              [error, restoreError],
              error instanceof Error
                ? error.message
                : t("mail.aiFilter.instructionFailed"),
            );
          }
          throw error;
        }
        toast(t("mail.aiFilter.promptRulesCleared"), {
          action: {
            label: t("mail.actions.undo"),
            onClick: () => void restoreRules(existing),
          },
        });
        return;
      }
      const name = `AI ${mode}: ${condition.slice(0, 72)}`;
      const [first, ...duplicates] = existing;
      if (first) {
        const result = await consolidateAiFilterRules.mutateAsync({
          id: first.id,
          duplicateIds: duplicates.map((rule) => rule.id),
          expectedRules: existing.map(({ id, name, condition, actions }) => ({
            id,
            name,
            condition,
            actions,
          })),
          name,
          condition,
          actions,
        });
        if (!result.saved) {
          toast.error(t("mail.aiFilter.instructionFailed"));
          setPromptDrafts((drafts) => ({
            ...drafts,
            [mode]: promptForRules(existing),
          }));
        }
      } else {
        await createRule.mutateAsync({
          name,
          condition,
          actions,
          kind: "ai-filter",
          domain: "mail",
        });
      }
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("mail.aiFilter.instructionFailed"),
      );
      setPromptDrafts((drafts) => ({
        ...drafts,
        [mode]: promptForRules(existing),
      }));
    }
  };

  const pinLabel = async (labelName: string) => {
    const current = settings?.pinnedLabels ?? [];
    const labelId = labelIdForName(labelName);
    if (current.includes(labelName) || current.includes(labelId)) return;
    await updatePreferences.mutateAsync({
      pinnedLabels: [...current, labelId],
    });
  };

  const saveNewTag = async () => {
    if (!jevConfigured) return;
    const name = newTagName.trim();
    const condition = newTagPrompt.trim();
    if (!name || !condition || savingNewTag) return;
    setSavingNewTag(true);
    try {
      await createRule.mutateAsync({
        name: `AI tag: ${condition.slice(0, 72)}`,
        condition,
        actions: [{ type: "label", labelName: name }],
        kind: "ai-filter",
        domain: "mail",
      });
      await pinLabel(name);
      setNewTagName("");
      setNewTagPrompt("");
      setNewTagOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    } finally {
      setSavingNewTag(false);
    }
  };

  const saveSuggestedTag = async (nameKey: string, promptKey: string) => {
    if (!jevConfigured || savingSuggestedTag) return;
    const name = t(nameKey);
    const condition = t(promptKey);
    setSavingSuggestedTag(nameKey);
    try {
      await createRule.mutateAsync({
        name: `AI tag: ${condition.slice(0, 72)}`,
        condition,
        actions: [{ type: "label", labelName: name }],
        kind: "ai-filter",
        domain: "mail",
      });
      await pinLabel(name);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    } finally {
      setSavingSuggestedTag(null);
    }
  };

  const updateTag = async (
    rule: AutomationRule,
    nameDraft: string,
    conditionDraft: string,
  ) => {
    if (!jevConfigured) return;
    const name = nameDraft.trim() || labelForRule(rule);
    const condition = conditionDraft.trim() || rule.condition;
    if (!name || !condition) return;
    if (name === labelForRule(rule) && condition === rule.condition) return;
    try {
      await updateRule.mutateAsync({
        id: rule.id,
        name: `AI tag: ${condition.slice(0, 72)}`,
        condition,
        actions: [{ type: "label", labelName: name }],
      });
      if (name !== labelForRule(rule)) {
        const oldIds = new Set([
          labelForRule(rule),
          normalizedLabelId(labelForRule(rule)),
          labelIdForName(labelForRule(rule)),
        ]);
        const current = settings?.pinnedLabels ?? [];
        const newId = labelIdForName(name);
        const updated = current
          .filter((id) => !oldIds.has(id))
          .concat(current.includes(newId) ? [] : [newId]);
        await updatePreferences.mutateAsync({ pinnedLabels: updated });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    }
  };

  const removeTag = async (rule: AutomationRule) => {
    try {
      await deleteRule.mutateAsync(rule.id);
      const labelName = labelForRule(rule);
      const oldIds = new Set([
        labelName,
        normalizedLabelId(labelName),
        labelIdForName(labelName),
      ]);
      await updatePreferences.mutateAsync({
        pinnedLabels: (settings?.pinnedLabels ?? []).filter(
          (id) => !oldIds.has(id),
        ),
      });
      setExpandedTagId(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    }
  };

  const reorderTags = async (draggedId: string, targetId: string) => {
    if (!jevConfigured || draggedId === targetId) return;
    const orderedNames = tagRules.map((rule) => labelForRule(rule));
    const from = tagRules.findIndex((rule) => rule.id === draggedId);
    const to = tagRules.findIndex((rule) => rule.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = orderedNames.splice(from, 1);
    orderedNames.splice(to, 0, moved);
    const current = settings?.pinnedLabels ?? [];
    const tagIds = new Set(
      tagRules.map((rule) => labelIdForName(labelForRule(rule))),
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
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.settingsFailed"),
      );
    }
  };

  if (filterLoading || rulesLoading || !state) {
    return <Skeleton className="h-72 w-full max-w-[720px]" />;
  }

  return (
    <>
      <div className="max-w-[720px] space-y-8 pb-10">
        <div className="flex items-center justify-between border-b border-border/50 pb-4">
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("mail.aiFilter.triageTitle")}
          </h2>
          <Switch
            checked={state.enabled}
            onCheckedChange={updateAiSettings}
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

        <section id="tags" className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[13px] font-semibold text-foreground">
                {t("mail.aiFilter.aiTagsTitle")}
              </h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground"
                    aria-label={t("mail.aiFilter.tagTabsHelp")}
                  >
                    <IconInfoCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("mail.aiFilter.tagTabsHelp")}
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!jevConfigured}
              onClick={() => {
                setNewTagOpen(true);
                setExpandedTagId("new");
              }}
            >
              <IconPlus className="size-3.5" />
              {t("mail.aiFilter.addTag")}
            </Button>
          </div>

          {tagRules.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/50">
              {tagRules.map((rule) => (
                <AiTagRow
                  key={rule.id}
                  rule={rule}
                  expanded={expandedTagId === rule.id}
                  disabled={!jevConfigured}
                  onToggle={() =>
                    setExpandedTagId((current) =>
                      current === rule.id ? null : rule.id,
                    )
                  }
                  onSave={(currentRule, name, condition) =>
                    void updateTag(currentRule, name, condition)
                  }
                  onDelete={removeTag}
                  onDrop={(event, targetId) => {
                    event.preventDefault();
                    if (!jevConfigured) return;
                    void reorderTags(
                      event.dataTransfer.getData("text/plain"),
                      targetId,
                    );
                  }}
                />
              ))}
              {newTagOpen && (
                <div className="space-y-3 bg-muted/20 p-3">
                  <Input
                    autoFocus
                    value={newTagName}
                    onChange={(event) => setNewTagName(event.target.value)}
                    onBlur={() => void saveNewTag()}
                    disabled={!jevConfigured}
                    aria-label={t("mail.aiFilter.tagNamePlaceholder")}
                    placeholder={t("mail.aiFilter.tagNamePlaceholder")}
                  />
                  <AiRulePromptField
                    value={newTagPrompt}
                    onChange={setNewTagPrompt}
                    onBlur={() => void saveNewTag()}
                    disabled={!jevConfigured}
                    label={t("mail.aiFilter.tagPlaceholder")}
                    placeholder={t("mail.aiFilter.tagPlaceholder")}
                  />
                </div>
              )}
            </div>
          ) : newTagOpen ? (
            <div className="space-y-3">
              <Input
                autoFocus
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                onBlur={() => void saveNewTag()}
                disabled={!jevConfigured}
                aria-label={t("mail.aiFilter.tagNamePlaceholder")}
                placeholder={t("mail.aiFilter.tagNamePlaceholder")}
              />
              <AiRulePromptField
                value={newTagPrompt}
                onChange={setNewTagPrompt}
                onBlur={() => void saveNewTag()}
                disabled={!jevConfigured}
                label={t("mail.aiFilter.tagPlaceholder")}
                placeholder={t("mail.aiFilter.tagPlaceholder")}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {TAG_SUGGESTIONS.slice(0, 3).map(([, nameKey, promptKey]) => (
                <Button
                  key={nameKey}
                  variant="outline"
                  size="sm"
                  disabled={!jevConfigured || savingSuggestedTag !== null}
                  onClick={() => void saveSuggestedTag(nameKey, promptKey)}
                >
                  <IconPlus className="size-3.5" />
                  {t(nameKey)}
                </Button>
              ))}
            </div>
          )}
        </section>

        {PROMPT_MODES.map((mode) => (
          <section
            key={mode}
            id={mode === "important" ? "importance-rules" : `${mode}-rules`}
            className="space-y-2 scroll-mt-6"
          >
            <h3 className="text-[13px] font-semibold text-foreground">
              {mode === "important"
                ? t("mail.aiFilter.importantMode")
                : mode === "archive"
                  ? t("mail.aiFilter.skipInboxMode")
                  : t("mail.aiFilter.spamMode")}
            </h3>
            <AiRulePromptField
              value={promptDrafts[mode]}
              disabled={
                !jevConfigured &&
                !(jevUnavailable && promptRules[mode].length > 0)
              }
              onChange={(value) => {
                if (!jevConfigured && value.trim()) return;
                setPromptDrafts((drafts) => ({ ...drafts, [mode]: value }));
              }}
              onBlur={() => void savePrompt(mode)}
              label={
                mode === "important"
                  ? t("mail.aiFilter.importantMode")
                  : mode === "archive"
                    ? t("mail.aiFilter.skipInboxMode")
                    : t("mail.aiFilter.spamMode")
              }
              placeholder={
                mode === "important"
                  ? t("mail.aiFilter.importantPlaceholder")
                  : mode === "archive"
                    ? t("mail.aiFilter.archivePlaceholder")
                    : t("mail.aiFilter.spamPlaceholder")
              }
              className="min-h-16 resize-y text-sm"
            />
          </section>
        ))}
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
