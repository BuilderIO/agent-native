import { useChatModels } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import {
  callAction,
  useActionMutation,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { STANDARD_APP_ROUTES } from "@agent-native/core/client/navigation";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsShellSkeleton,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsAppArea,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import {
  legacyMailSettingsTab,
  legacyMailSettingsTabForPath,
  mailSettingsRedirect,
  mailSettingsSectionFromPath,
  type MailSettingsAreaId,
} from "@shared/settings-navigation";
import type {
  Alias,
  AutomationAction,
  AutomationRule,
  UserSettings,
} from "@shared/types";
import {
  IconUsers,
  IconPlus,
  IconPencil,
  IconTrash,
  IconLoader2,
  IconBolt,
  IconX,
  IconChartBar,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlayerPlay,
  IconSignature,
  IconPhoto,
  IconFilter,
  IconInfoCircle,
  IconMessage2,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { AiFilterSection } from "@/components/settings/AiFilterSection";
import { GmailFiltersSection } from "@/components/settings/GmailFiltersSection";
import "@/components/settings/slack-channel-extension";
import { SnippetsSection } from "@/components/settings/SnippetsSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAliases,
  useCreateAlias,
  useUpdateAlias,
  useDeleteAlias,
} from "@/hooks/use-aliases";
import {
  useAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
} from "@/hooks/use-automations";
import { useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { isMailFrameworkAutomation } from "@/lib/automation-visibility";
import { openFilePicker, uploadFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

import changelog from "../../CHANGELOG.md?raw";

// ─── Alias Edit Row ───────────────────────────────────────────────────────────

function AliasEditRow({
  alias,
  onSave,
  onCancel,
  isPending,
}: {
  alias?: Alias;
  onSave: (name: string, emails: string[]) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState(alias?.name ?? "");
  const [emailsText, setEmailsText] = useState(alias?.emails.join("\n") ?? "");

  const handleSave = () => {
    const emails = emailsText
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!name.trim() || emails.length === 0) return;
    onSave(name.trim(), emails);
  };

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.aliasName")}
        </label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.aliasNamePlaceholder")}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.recipientsOnePerLine")}
        </label>
        <Textarea
          value={emailsText}
          onChange={(e) => setEmailsText(e.target.value)}
          placeholder={"alice@example.com\nbob@example.com"}
          rows={4}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40 resize-none font-mono"
        />
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          onClick={handleSave}
          disabled={!name.trim() || !emailsText.trim() || isPending}
          size="sm"
        >
          {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("settings.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("settings.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ─── Alias Row ────────────────────────────────────────────────────────────────

function AliasRow({
  alias,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  alias: Alias;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const t = useT();
  const updateAlias = useUpdateAlias();
  const deleteAlias = useDeleteAlias();
  const rowRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isEditing && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isEditing]);

  const handleSave = (name: string, emails: string[]) => {
    updateAlias.mutate(
      { id: alias.id, name, emails },
      { onSuccess: onCancelEdit },
    );
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    deleteAlias.mutate(alias.id);
    setShowDeleteConfirm(false);
  };

  if (isEditing) {
    return (
      <div ref={rowRef}>
        <AliasEditRow
          alias={alias}
          onSave={handleSave}
          onCancel={onCancelEdit}
          isPending={updateAlias.isPending}
        />
      </div>
    );
  }

  return (
    <>
      <div
        ref={rowRef}
        className="flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3 group hover:border-border/60"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-foreground">
              {alias.name}
            </span>
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
              {alias.emails.length}{" "}
              {t(
                alias.emails.length === 1
                  ? "settings.personSingular"
                  : "settings.peoplePlural",
                { count: alias.emails.length },
              )}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground truncate">
            {alias.emails.join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-7 w-7 p-0"
              >
                <IconPencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.editAlias")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteAlias.isPending}
                className="h-7 w-7 p-0"
              >
                {deleteAlias.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconTrash className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.deleteAlias")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deleteAlias")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.deleteAliasDescription", { name: alias.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("settings.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Aliases Section ──────────────────────────────────────────────────────────

function AliasesSection({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { data: aliases = [], isLoading } = useAliases();
  const createAlias = useCreateAlias();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Handle ?alias=<id> query param — open that alias in edit mode
  const aliasParam = searchParams.get("alias");
  useEffect(() => {
    if (aliasParam && aliases.length > 0) {
      const exists = aliases.find((a) => a.id === aliasParam);
      if (exists) {
        setEditingId(aliasParam);
        // Clear the param so it doesn't re-trigger on every render
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("alias");
          return next;
        });
      }
    }
  }, [aliasParam, aliases]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = (name: string, emails: string[]) => {
    createAlias.mutate(
      { name, emails },
      {
        onSuccess: () => setShowNewForm(false),
      },
    );
  };

  const newAliasButton = (
    <Button
      size="sm"
      onClick={() => {
        setShowNewForm(true);
        setEditingId(null);
      }}
    >
      <IconPlus className="h-3.5 w-3.5" />
      {t("settings.newAlias")}
    </Button>
  );

  return (
    <div>
      {/* Header */}
      {embedded ? (
        <div className="mb-4 flex justify-end">{newAliasButton}</div>
      ) : (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">
              {t("settings.aliases")}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {t("settings.aliasesDescription")}
            </p>
          </div>
          {newAliasButton}
        </div>
      )}

      {/* Content */}
      <div className={embedded ? "space-y-2" : "max-w-2xl space-y-2"}>
        {/* New alias form at top */}
        {showNewForm && (
          <AliasEditRow
            onSave={handleCreate}
            onCancel={() => setShowNewForm(false)}
            isPending={createAlias.isPending}
          />
        )}

        {/* Loading state */}
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/50 p-3"
            >
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          ))}

        {/* Empty state */}
        {!isLoading && aliases.length === 0 && !showNewForm && (
          <div className="rounded-lg border border-border/20 bg-card/50 py-12 text-center">
            <IconUsers className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-[13px] text-muted-foreground/50">
              {t("settings.noAliases")}
            </p>
          </div>
        )}

        {/* Alias list */}
        {aliases.map((alias) => (
          <AliasRow
            key={alias.id}
            alias={alias}
            isEditing={editingId === alias.id}
            onEdit={() => {
              setEditingId(alias.id);
              setShowNewForm(false);
            }}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Action Badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: AutomationAction }) {
  const label =
    action.type === "label" ? `label: ${action.labelName}` : action.type;
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
      {label}
    </span>
  );
}

// ─── Action Builder ───────────────────────────────────────────────────────────

const ACTION_TYPES = [
  { value: "label", labelKey: "settings.applyLabel" },
  { value: "archive", labelKey: "settings.archive" },
  { value: "mark_read", labelKey: "settings.markRead" },
  { value: "star", labelKey: "settings.star" },
  { value: "trash", labelKey: "settings.trash" },
] as const;

function ActionBuilder({
  actions,
  onChange,
}: {
  actions: AutomationAction[];
  onChange: (actions: AutomationAction[]) => void;
}) {
  const t = useT();
  const addAction = () => {
    onChange([...actions, { type: "label", labelName: "" }]);
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  const updateAction = (index: number, updated: AutomationAction) => {
    const next = [...actions];
    next[index] = updated;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {actions.map((action, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Select
            value={action.type}
            onValueChange={(value: string) => {
              const type = value as AutomationAction["type"];
              if (type === "label") {
                updateAction(idx, { type: "label", labelName: "" });
              } else {
                updateAction(idx, { type } as AutomationAction);
              }
            }}
          >
            <SelectTrigger size="sm" className="w-[140px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((actionType) => (
                <SelectItem key={actionType.value} value={actionType.value}>
                  {t(actionType.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {action.type === "label" && (
            <Input
              size="sm"
              value={action.labelName}
              onChange={(e) =>
                updateAction(idx, { type: "label", labelName: e.target.value })
              }
              placeholder={t("settings.labelName")}
              className="flex-1 px-2 text-[13px] placeholder:text-muted-foreground/40"
            />
          )}

          <button
            onClick={() => removeAction(idx)}
            className="p-1 text-muted-foreground/40 hover:text-destructive"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={addAction}
        className="text-[12px] text-indigo-400 hover:text-indigo-300"
      >
        {t("settings.addAction")}
      </button>
    </div>
  );
}

// ─── Automation Edit Row ──────────────────────────────────────────────────────

function AutomationEditRow({
  rule,
  onSave,
  onCancel,
  isPending,
}: {
  rule?: AutomationRule;
  onSave: (data: {
    name: string;
    condition: string;
    actions: AutomationAction[];
  }) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState(rule?.name ?? "");
  const [condition, setCondition] = useState(rule?.condition ?? "");
  const [actions, setActions] = useState<AutomationAction[]>(
    rule?.actions ?? [{ type: "label", labelName: "" }],
  );

  const handleSave = () => {
    if (!name.trim() || !condition.trim() || actions.length === 0) return;
    // Validate label actions have names
    const valid = actions.every(
      (a) => a.type !== "label" || (a.type === "label" && a.labelName.trim()),
    );
    if (!valid) return;
    onSave({ name: name.trim(), condition: condition.trim(), actions });
  };

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.ruleName")}
        </label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.ruleNamePlaceholder")}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.conditionNaturalLanguage")}
        </label>
        <Textarea
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder={t("settings.conditionPlaceholder")}
          rows={3}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40 resize-none"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.actions")}
        </label>
        <ActionBuilder actions={actions} onChange={setActions} />
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          onClick={handleSave}
          disabled={
            !name.trim() ||
            !condition.trim() ||
            actions.length === 0 ||
            isPending
          }
          size="sm"
        >
          {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("settings.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("settings.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ─── Automation Row ───────────────────────────────────────────────────────────

function AutomationRow({
  rule,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  rule: AutomationRule;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const t = useT();
  const updateAutomation = useUpdateAutomation();
  const deleteAutomation = useDeleteAutomation();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isEditing]);

  const handleSave = (data: {
    name: string;
    condition: string;
    actions: AutomationAction[];
  }) => {
    updateAutomation.mutate(
      { id: rule.id, ...data },
      { onSuccess: onCancelEdit },
    );
  };

  const handleToggle = (enabled: boolean) => {
    updateAutomation.mutate({ id: rule.id, enabled });
  };

  if (isEditing) {
    return (
      <div ref={rowRef}>
        <AutomationEditRow
          rule={rule}
          onSave={handleSave}
          onCancel={onCancelEdit}
          isPending={updateAutomation.isPending}
        />
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className="flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3 group hover:border-border/60"
    >
      <div className="pt-0.5">
        <Switch checked={rule.enabled} onCheckedChange={handleToggle} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={cn(
              "text-[13px] font-semibold",
              rule.enabled ? "text-foreground" : "text-muted-foreground/50",
            )}
          >
            {rule.name}
          </span>
        </div>
        <p
          className={cn(
            "text-[12px] mb-1.5",
            rule.enabled ? "text-muted-foreground" : "text-muted-foreground/40",
          )}
        >
          {rule.condition}
        </p>
        <div className="flex flex-wrap gap-1">
          {rule.actions.map((action, idx) => (
            <ActionBadge key={idx} action={action} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              className="h-7 w-7 p-0"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("settings.editRule")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteAutomation.mutate(rule.id)}
              disabled={deleteAutomation.isPending}
              className="h-7 w-7 p-0"
            >
              {deleteAutomation.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconTrash className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("settings.deleteRule")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// ─── Framework Triggers Subsection ──────────────────────────────────────────

interface FrameworkTrigger {
  id: string;
  name: string;
  appId?: string;
  triggerType: string;
  event?: string;
  condition?: string;
  mode: string;
  domain?: string;
  enabled: boolean;
  lastStatus?: string;
  lastRun?: string;
  lastError?: string;
  body: string;
}

function TriggersSubsection() {
  const t = useT();
  const { data: triggers = [], isLoading } = useQuery<FrameworkTrigger[]>({
    queryKey: ["framework-triggers-mail"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/automations"));
      if (!res.ok) return [];
      const all: FrameworkTrigger[] = await res.json();
      return all.filter(isMailFrameworkAutomation);
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (triggers.length === 0) {
    return (
      <div className="rounded-lg border border-border/20 bg-card/50 py-8 text-center">
        <IconPlayerPlay className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-[12px] text-muted-foreground/50">
          {t("settings.noEventAutomations")}
        </p>
        <p className="text-[11px] text-muted-foreground/30 max-w-xs mx-auto mt-1">
          {t("settings.eventAutomationsPrompt")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {triggers.map((trigger) => {
        const StatusIcon =
          trigger.lastStatus === "success"
            ? IconCircleCheck
            : trigger.lastStatus === "error"
              ? IconCircleX
              : trigger.lastStatus === "running"
                ? IconLoader2
                : IconClock;
        const statusColor =
          trigger.lastStatus === "success"
            ? "text-green-400"
            : trigger.lastStatus === "error"
              ? "text-red-400"
              : trigger.lastStatus === "running"
                ? "text-yellow-400 animate-spin"
                : "text-muted-foreground/40";

        return (
          <div
            key={trigger.id}
            className="flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3"
          >
            <div className="pt-0.5">
              <StatusIcon className={cn("h-4 w-4", statusColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={cn(
                    "text-[13px] font-semibold",
                    trigger.enabled
                      ? "text-foreground"
                      : "text-muted-foreground/50",
                  )}
                >
                  {trigger.name}
                </span>
                {!trigger.enabled && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50">
                    {t("settings.disabled")}
                  </span>
                )}
              </div>
              {trigger.event && (
                <p className="text-[11px] text-muted-foreground/60 mb-0.5">
                  {t("settings.on")}{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                    {trigger.event}
                  </code>
                  {trigger.condition && (
                    <span>
                      {" "}
                      {t("settings.when")} <em>"{trigger.condition}"</em>
                    </span>
                  )}
                </p>
              )}
              <p className="text-[12px] text-muted-foreground line-clamp-2">
                {trigger.body}
              </p>
              {trigger.lastRun && (
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  {t("settings.lastRun")}{" "}
                  {new Date(trigger.lastRun).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  {trigger.lastError && (
                    <span className="text-red-400"> — {trigger.lastError}</span>
                  )}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Automations Section ─────────────────────────────────────────────────────

type AutomationSettings = {
  engine?: string;
  model?: string;
  allowAutomationSends: boolean;
};

function AutomationsSection({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { data: rules = [], isLoading } = useAutomations();
  const createAutomation = useCreateAutomation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const { availableModels, defaultModel } = useChatModels({
    storageKey: "agent-native:mail-automations:model",
  });
  const modelOptions = useMemo(() => {
    const configuredGroups = availableModels.filter(
      (group) => group.configured,
    );
    const groups =
      configuredGroups.length > 0 ? configuredGroups : availableModels;
    return groups.flatMap((group) =>
      group.models.map((model) => ({
        value: `${group.engine}::${model}`,
        engine: group.engine,
        model,
        label: `${group.label} / ${model}`,
      })),
    );
  }, [availableModels]);

  // Refetch on any settings write or agent action so agent-driven changes
  // (e.g. update-automation-settings) show up without a manual refresh.
  const settingsSync = useChangeVersions(["settings", "action"]);
  const { data: autoSettings } = useQuery<AutomationSettings>({
    queryKey: ["automation-settings", settingsSync],
    queryFn: async (): Promise<AutomationSettings> => {
      try {
        return await callAction(
          "get-automation-settings",
          {},
          { method: "GET" },
        );
      } catch {
        return { model: defaultModel, allowAutomationSends: false };
      }
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
  const [isSavingAutomationSends, setIsSavingAutomationSends] = useState(false);
  const selectedModel = autoSettings?.model || defaultModel;
  const selectedEngine =
    autoSettings?.engine ||
    modelOptions.find((option) => option.model === selectedModel)?.engine ||
    "anthropic";
  const selectedValue =
    modelOptions.find(
      (option) =>
        option.engine === selectedEngine && option.model === selectedModel,
    )?.value ||
    modelOptions[0]?.value ||
    "loading";
  const automationRules = rules.filter((rule) => rule.kind !== "ai-filter");

  const handleModelChange = async (value: string) => {
    const [engine, model] = value.split("::");
    if (!engine || !model) return;
    queryClient.setQueriesData<AutomationSettings>(
      { queryKey: ["automation-settings"] },
      (current) =>
        current
          ? { ...current, engine, model }
          : { engine, model, allowAutomationSends: false },
    );
    await callAction(
      "update-automation-settings",
      { engine, model },
      { method: "PUT" },
    );
  };

  const handleAutomationSendsChange = async (enabled: boolean) => {
    if (!autoSettings || isSavingAutomationSends) return;
    const previous = autoSettings.allowAutomationSends;
    queryClient.setQueriesData<AutomationSettings>(
      { queryKey: ["automation-settings"] },
      (current) =>
        current ? { ...current, allowAutomationSends: enabled } : current,
    );
    setIsSavingAutomationSends(true);
    try {
      await callAction(
        "update-automation-settings",
        { allowAutomationSends: enabled },
        { method: "PUT" },
      );
    } catch (error) {
      queryClient.setQueriesData<AutomationSettings>(
        { queryKey: ["automation-settings"] },
        (current) =>
          current ? { ...current, allowAutomationSends: previous } : current,
      );
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.automationSendSettingSaveFailed"),
      );
    } finally {
      setIsSavingAutomationSends(false);
      await queryClient.invalidateQueries({
        queryKey: ["automation-settings"],
      });
    }
  };

  const handleCreate = (data: {
    name: string;
    condition: string;
    actions: AutomationAction[];
  }) => {
    createAutomation.mutate(data, {
      onSuccess: () => setShowNewForm(false),
    });
  };

  const modelSelect = (
    <Select
      value={selectedValue}
      onValueChange={handleModelChange}
      disabled={modelOptions.length === 0}
    >
      <SelectTrigger
        size="sm"
        className="w-[260px] text-xs"
        aria-label={embedded ? t("settings.rulesModel") : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {modelOptions.length === 0 ? (
          <SelectItem value="loading" disabled className="text-xs">
            {t("settings.loadingModels")}
          </SelectItem>
        ) : (
          modelOptions.map((m) => (
            <SelectItem key={m.value} value={m.value} className="text-xs">
              {m.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );

  const newRuleButton = (
    <Button
      size="sm"
      onClick={() => {
        setShowNewForm(true);
        setEditingId(null);
      }}
    >
      <IconPlus className="h-3.5 w-3.5" />
      {t("settings.newRule")}
    </Button>
  );

  const ruleList = (
    <div className={embedded ? "space-y-2" : "max-w-2xl space-y-2"}>
      {/* New rule form */}
      {showNewForm && (
        <AutomationEditRow
          onSave={handleCreate}
          onCancel={() => setShowNewForm(false)}
          isPending={createAutomation.isPending}
        />
      )}

      {/* Loading state */}
      {isLoading &&
        Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/50 p-3"
          >
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}

      {/* Empty state */}
      {!isLoading && automationRules.length === 0 && !showNewForm && (
        <div className="rounded-lg border border-border/20 bg-card/50 py-12 text-center">
          <IconBolt className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-[13px] text-muted-foreground/50 mb-1">
            {t("settings.noAutomationRules")}
          </p>
          <p className="text-[12px] text-muted-foreground/30 max-w-sm mx-auto">
            {t("settings.noAutomationRulesDescription")}
          </p>
        </div>
      )}

      {/* Rule list */}
      {automationRules.map((rule) => (
        <AutomationRow
          key={rule.id}
          rule={rule}
          isEditing={editingId === rule.id}
          onEdit={() => {
            setEditingId(rule.id);
            setShowNewForm(false);
          }}
          onCancelEdit={() => setEditingId(null)}
        />
      ))}
    </div>
  );

  // The redesigned Settings lists event-triggered automations on the core
  // Automations page, so this area holds only Mail's inbox rules.
  if (embedded) {
    return (
      <div className="flex flex-col gap-8">
        <SettingsGroup id="rules-settings">
          <SettingsRow
            id="rules-model"
            label={t("settings.rulesModel")}
            description={t("settings.rulesModelDescription")}
            control={modelSelect}
          />
          <SettingsRow
            id="allow-automation-sends"
            label={t("settings.allowAutomationSends")}
            description={t("settings.allowAutomationSendsDescription")}
            control={
              autoSettings ? (
                <Switch
                  aria-label={t("settings.allowAutomationSends")}
                  checked={autoSettings.allowAutomationSends}
                  disabled={isSavingAutomationSends}
                  onCheckedChange={handleAutomationSendsChange}
                />
              ) : (
                <Skeleton className="h-5 w-9 rounded-full" />
              )
            }
          />
        </SettingsGroup>
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">{newRuleButton}</div>
          {ruleList}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("settings.automations")}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("settings.automationsDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">{modelSelect}</div>
        {newRuleButton}
      </div>

      <div className="max-w-2xl mb-6">
        {autoSettings ? (
          <SettingsSwitchRow
            title={t("settings.allowAutomationSends")}
            description={t("settings.allowAutomationSendsDescription")}
            checked={autoSettings.allowAutomationSends}
            disabled={isSavingAutomationSends}
            onCheckedChange={handleAutomationSendsChange}
          />
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </div>

      {/* Content */}
      {ruleList}

      {/* Event-triggered automations (framework-level triggers) */}
      <div className="max-w-2xl mt-10">
        <div className="mb-4">
          <h3 className="text-[14px] font-semibold text-foreground">
            {t("settings.eventTriggers")}
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {t("settings.eventTriggersDescription")}
          </p>
        </div>
        <TriggersSubsection />
      </div>
    </div>
  );
}

// ─── Drafting Section ────────────────────────────────────────────────────────

function DraftingSection({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const [signature, setSignature] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
  const signatureSelectionRef = useRef({ start: 0, end: 0 });
  const importSignature = useActionMutation("import-gmail-signature", {
    onSuccess: (result) => {
      setSignature(result.signature);
      queryClient.setQueryData<UserSettings>(["settings"], (prev) =>
        prev ? { ...prev, signature: result.signature } : prev,
      );
      if (result.imported) {
        toast(t("settings.importedSignature", { account: result.account }));
      } else {
        toast(t("settings.noGmailSignature", { account: result.account }));
      }
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.importSignatureFailed"),
      ),
  });

  useEffect(() => {
    if (!settings) return;
    setSignature(settings.signature ?? "");
    setWritingStyle(settings.writingStyle ?? "");
  }, [settings?.signature, settings?.writingStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedSignature = settings?.signature ?? "";
  const savedWritingStyle = settings?.writingStyle ?? "";
  const isDirty =
    signature !== savedSignature || writingStyle !== savedWritingStyle;

  const insertSignatureImage = async (
    file: File,
    start: number,
    end: number,
  ) => {
    try {
      const result = await uploadFile(file);
      const markdown = `![${file.name.replace(/\.[^.]+$/, "")}](${result.url})`;
      setSignature(
        (current) =>
          `${current.slice(0, start)}${markdown}${current.slice(end)}`,
      );
    } catch {
      toast.error(t("settings.signatureImageUploadFailed"));
    }
  };

  const handleSignaturePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const target = event.currentTarget;
    void insertSignatureImage(
      image,
      target.selectionStart,
      target.selectionEnd,
    );
  };

  const handleSignatureImage = async () => {
    const file = await openFilePicker("image/*");
    if (!file) return;
    await insertSignatureImage(
      file,
      signatureSelectionRef.current.start,
      signatureSelectionRef.current.end,
    );
  };

  const handleSave = () => {
    updateSettings.mutate(
      {
        signature: signature.trim(),
        writingStyle: writingStyle.trim(),
      },
      {
        onSuccess: () => toast(t("settings.draftingSettingsSaved")),
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("settings.draftingSettingsSaveFailed"),
          ),
      },
    );
  };

  const autocompleteSwitch = (
    <Switch
      id="mail-autocomplete-setting"
      aria-label={embedded ? t("settings.autocomplete") : undefined}
      checked={settings?.autocompleteEnabled ?? false}
      onCheckedChange={(checked) =>
        updateSettings.mutate(
          { autocompleteEnabled: checked },
          {
            onError: (error) =>
              toast.error(
                error instanceof Error
                  ? error.message
                  : t("settings.autocompleteSaveFailed"),
              ),
          },
        )
      }
      disabled={updateSettings.isPending}
    />
  );
  const sendAndMarkDoneSwitch = (
    <Switch
      id="mail-send-and-mark-done-setting"
      aria-label={embedded ? t("settings.sendAndMarkDone") : undefined}
      checked={settings?.sendAndArchive ?? false}
      onCheckedChange={(checked) =>
        updateSettings.mutate(
          { sendAndArchive: checked },
          {
            onError: () =>
              toast.error(t("settings.draftingSettingsSaveFailed")),
          },
        )
      }
      disabled={updateSettings.isPending}
    />
  );
  const importSignatureButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px]"
      onClick={() => importSignature.mutate({})}
      disabled={importSignature.isPending}
    >
      {importSignature.isPending && (
        <IconLoader2 className="h-3 w-3 animate-spin" />
      )}
      {t("settings.importFromGmail")}
    </Button>
  );
  const signatureImageButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px]"
      onClick={() => void handleSignatureImage()}
    >
      <IconPhoto className="h-3 w-3" />
      {t("settings.addSignatureImage")}
    </Button>
  );
  const signatureInput = (
    <Textarea
      value={signature}
      aria-label={embedded ? t("settings.signature") : undefined}
      onChange={(event) => setSignature(event.target.value)}
      onPaste={handleSignaturePaste}
      onSelect={(event) => {
        signatureSelectionRef.current = {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        };
      }}
      placeholder={"Best,\nSteve"}
      rows={5}
      className="resize-none px-3 py-2 text-[13px] placeholder:text-muted-foreground/40"
    />
  );
  const writingStyleInput = (
    <Textarea
      value={writingStyle}
      aria-label={embedded ? t("settings.writingStyle") : undefined}
      onChange={(event) => setWritingStyle(event.target.value)}
      placeholder={t("settings.writingStylePlaceholder")}
      rows={4}
      className="resize-none px-3 py-2 text-[13px] placeholder:text-muted-foreground/40"
    />
  );
  const saveButtons = (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={handleSave}
        disabled={!isDirty || updateSettings.isPending}
      >
        {updateSettings.isPending && (
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {t("settings.saveDraftingSettings")}
      </Button>
      {isDirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSignature(savedSignature);
            setWritingStyle(savedWritingStyle);
          }}
        >
          {t("settings.reset")}
        </Button>
      )}
    </div>
  );

  if (embedded) {
    if (isLoading) return <SettingsRowsSkeleton groups={[2, 2]} />;
    return (
      <div className="flex flex-col gap-8">
        <SettingsGroup id="composing">
          <SettingsRow
            id="autocomplete"
            label={t("settings.autocomplete")}
            control={autocompleteSwitch}
          />
          <SettingsRow
            id="send-and-mark-done"
            label={t("settings.sendAndMarkDone")}
            control={sendAndMarkDoneSwitch}
          />
        </SettingsGroup>
        <div className="flex flex-col gap-4">
          <SettingsGroup id="signature-and-style">
            <SettingsRow
              id="signature"
              label={t("settings.signature")}
              description={t("settings.signatureHelp")}
              control={importSignatureButton}
            >
              <div className="flex flex-col gap-2">
                {signatureInput}
                <div>{signatureImageButton}</div>
              </div>
            </SettingsRow>
            <SettingsRow id="writing-style" label={t("settings.writingStyle")}>
              {writingStyleInput}
            </SettingsRow>
          </SettingsGroup>
          {saveButtons}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.drafting")}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.draftingDescription")}
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border/20 bg-card/50 px-4 py-3">
              <label
                htmlFor="mail-autocomplete-setting"
                className="text-[13px] font-medium text-foreground"
              >
                {t("settings.autocomplete")}
              </label>
              {autocompleteSwitch}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/20 bg-card/50 px-4 py-3">
              <label
                htmlFor="mail-send-and-mark-done-setting"
                className="text-[13px] font-medium text-foreground"
              >
                {t("settings.sendAndMarkDone")}
              </label>
              {sendAndMarkDoneSwitch}
            </div>

            <div className="rounded-lg border border-border/20 bg-card/50 p-4">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("settings.signature")}
                </label>
                {importSignatureButton}
                {signatureImageButton}
              </div>
              {signatureInput}
              <p className="mt-2 text-[12px] text-muted-foreground">
                {t("settings.signatureHelp")}
              </p>
            </div>

            <div className="rounded-lg border border-border/20 bg-card/50 p-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.writingStyle")}
              </label>
              {writingStyleInput}
            </div>

            {saveButtons}
          </>
        )}
      </div>
    </div>
  );
}

/** Layout-matching placeholder for areas built from `SettingsGroup` rows. */
function SettingsRowsSkeleton({ groups }: { groups: readonly number[] }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((rows, group) => (
        <div
          key={group}
          className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SettingsSwitchRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/20 bg-card/50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function TrackingSection({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const tracking = settings?.tracking ?? { opens: false, clicks: false };

  const update = (patch: Partial<{ opens: boolean; clicks: boolean }>) => {
    updateSettings.mutate({
      tracking: { ...tracking, ...patch },
    });
  };

  if (embedded) {
    if (isLoading) return <SettingsRowsSkeleton groups={[2]} />;
    return (
      <SettingsGroup id="tracking-settings">
        <SettingsRow
          id="track-opens"
          label={t("settings.trackEmailOpens")}
          description={t("settings.trackEmailOpensDescription")}
          control={
            <Switch
              aria-label={t("settings.trackEmailOpens")}
              checked={tracking.opens}
              onCheckedChange={(v) => update({ opens: v })}
            />
          }
        />
        <SettingsRow
          id="track-clicks"
          label={t("settings.trackLinkClicks")}
          description={t("settings.trackLinkClicksDescription")}
          control={
            <Switch
              aria-label={t("settings.trackLinkClicks")}
              checked={tracking.clicks}
              onCheckedChange={(v) => update({ clicks: v })}
            />
          }
        />
      </SettingsGroup>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.tracking")}
        </h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          {t("settings.trackingDescription")}
        </p>
      </div>

      <div className="max-w-2xl space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : (
          <>
            <SettingsSwitchRow
              title={t("settings.trackEmailOpens")}
              description={t("settings.trackEmailOpensDescription")}
              checked={tracking.opens}
              onCheckedChange={(v) => update({ opens: v })}
            />
            <SettingsSwitchRow
              title={t("settings.trackLinkClicks")}
              description={t("settings.trackLinkClicksDescription")}
              checked={tracking.clicks}
              onCheckedChange={(v) => update({ clicks: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Slack Intake Section ───────────────────────────────────────────────────

type SlackStatus = {
  enabled: boolean;
  configured: boolean;
  webhookUrl?: string;
  error?: string;
};

function SlackIntakeSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<SlackStatus>({
    queryKey: ["integration-status", "slack"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/integrations/slack/status"),
      );
      if (!res.ok) throw new Error(t("settings.slackLoadFailed"));
      return res.json();
    },
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/integrations/slack/${enabled ? "enable" : "disable"}`,
        ),
        { method: "POST" },
      );
      if (!res.ok) throw new Error(t("settings.slackUpdateFailed"));
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["integration-status", "slack"],
      }),
  });
  const slackStatusDescription = data?.configured
    ? t("settings.slackConfigured")
    : t("settings.slackNeedsCredentials");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.slackIntake")}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.slackDescription")}
        </p>
      </div>

      <div className="max-w-2xl space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/20 bg-card/50 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {data?.configured ? (
                    <IconCircleCheck className="h-4 w-4 text-green-400" />
                  ) : (
                    <IconCircleX className="h-4 w-4 text-red-400" />
                  )}
                  <span className="text-[13px] font-semibold text-foreground">
                    {data?.enabled
                      ? t("settings.enabled")
                      : t("settings.disabled")}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {slackStatusDescription}
                </p>
                {data?.configured && data?.error && (
                  <p className="mt-1 text-[11px] text-red-400">{data.error}</p>
                )}
              </div>
              <Button
                size="sm"
                disabled={!data?.configured || toggle.isPending}
                onClick={() => toggle.mutate(!data?.enabled)}
              >
                {toggle.isPending && (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {data?.enabled ? t("settings.disable") : t("settings.enable")}
              </Button>
            </div>
            {data?.configured && data?.webhookUrl && (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("settings.slackPostEndpoint")}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconInfoCircle className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("settings.slackPostEndpointHelp")}
                    </TooltipContent>
                  </Tooltip>
                </label>
                <Input readOnly value={data.webhookUrl} className="font-mono" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── What's New Section ──────────────────────────────────────────────────────

function GeneralSection() {
  const t = useT();
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.general")}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.generalDescription")}
        </p>
      </div>

      <SettingsGroup className="max-w-2xl border-border/20 bg-card/50">
        <SettingsRow
          id="language"
          label={t("settings.languageTitle")}
          description={t("settings.languageDescription")}
          control={
            <div className="w-56">
              <LanguagePicker label={t("settings.languageLabel")} />
            </div>
          }
        />
      </SettingsGroup>
    </div>
  );
}

function WhatsNewSection() {
  const t = useT();
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.whatsNew")}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.whatsNewDescription")}
        </p>
      </div>

      <div className="max-w-2xl">
        <ChangelogSettingsCard markdown={changelog} />
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

type MailSettingsAppArea = SettingsAppArea & { id: MailSettingsAreaId };

/** Mail's areas: tabs on Mail › General in the redesigned Settings. */
function useMailSettingsAreas(): MailSettingsAppArea[] {
  const t = useT();
  return useMemo<MailSettingsAppArea[]>(
    () => [
      {
        id: "drafting",
        label: t("settings.drafting"),
        icon: IconSignature,
        keywords: "signature writing style compose reply draft",
        searchEntries: [
          {
            id: "mail-autocomplete",
            label: t("settings.autocomplete"),
            keywords: "autocomplete suggestions compose",
            hash: "autocomplete",
          },
          {
            id: "mail-send-and-mark-done",
            label: t("settings.sendAndMarkDone"),
            keywords: "send archive mark done",
            hash: "send-and-mark-done",
          },
          {
            id: "mail-signature",
            label: t("settings.signature"),
            keywords: "signature sign off gmail import image",
            hash: "signature",
          },
          {
            id: "mail-writing-style",
            label: t("settings.writingStyle"),
            keywords: "writing style tone voice",
            hash: "writing-style",
          },
        ],
        content: <DraftingSection embedded />,
      },
      {
        id: "snippets",
        label: t("settings.snippets"),
        icon: IconMessage2,
        keywords: "snippets templates canned responses shortcuts",
        content: <SnippetsSection embedded />,
      },
      {
        id: "rules",
        label: t("settings.rules"),
        icon: IconBolt,
        keywords: "rules inbox automations triggers labels archive star",
        searchEntries: [
          {
            id: "mail-rules-model",
            label: t("settings.rulesModel"),
            keywords: "model llm rules automations",
            hash: "rules-model",
          },
          {
            id: "mail-allow-automation-sends",
            label: t("settings.allowAutomationSends"),
            keywords: "send automatically rules automations",
            hash: "allow-automation-sends",
          },
        ],
        content: <AutomationsSection embedded />,
      },
      {
        id: "ai-filter",
        label: t("settings.aiFilter"),
        icon: IconFilter,
        keywords:
          "ai filter spam auto label unwanted mail suggestions feedback",
        content: <AiFilterSection embedded />,
      },
      {
        id: "gmail-filters",
        label: t("settings.gmailFilters"),
        icon: IconFilter,
        keywords: "gmail filters import rules",
        content: <GmailFiltersSection embedded />,
      },
      {
        id: "aliases",
        label: t("settings.aliases"),
        icon: IconUsers,
        keywords: "aliases groups distribution lists recipients",
        content: <AliasesSection embedded />,
      },
      {
        id: "tracking",
        label: t("settings.tracking"),
        icon: IconChartBar,
        keywords: "tracking opens clicks pixel analytics",
        searchEntries: [
          {
            id: "mail-track-opens",
            label: t("settings.trackEmailOpens"),
            keywords: "tracking opens pixel read receipts",
            hash: "track-opens",
          },
          {
            id: "mail-track-clicks",
            label: t("settings.trackLinkClicks"),
            keywords: "tracking clicks links",
            hash: "track-clicks",
          },
        ],
        content: <TrackingSection embedded />,
      },
    ],
    [t],
  );
}

export function SettingsPage() {
  const flag = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);
  if (flag.status === "loading") {
    return <SettingsShellSkeleton className="flex-1" />;
  }
  return flag.enabled ? <MailSettingsShell /> : <LegacyMailSettings />;
}

/**
 * Mail › General with Mail's areas as tabs. Language is on Account ›
 * Preferences, members on Organization › Members, and Slack draft requests
 * on Channels › Slack (see `slack-channel-extension`).
 */
function MailSettingsShell() {
  const agentSettingsTabs = useAgentSettingsTabs();
  const appAreas = useMailSettingsAreas();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navState = useNavigationState();
  const section = mailSettingsSectionFromPath(pathname);

  useEffect(() => {
    navState.sync({ view: "settings", settingsSection: section });
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const redirect = mailSettingsRedirect(searchParams.get("section"));
  if (redirect) {
    const rest = new URLSearchParams(searchParams);
    rest.delete("section");
    const search = rest.toString();
    return (
      <Navigate
        to={{ pathname: redirect, search: search ? `?${search}` : "" }}
        replace
      />
    );
  }

  return (
    <SettingsTabsPage
      className="flex-1"
      extraTabs={agentSettingsTabs}
      appAreas={appAreas}
      whatsNewMarkdown={changelog}
    />
  );
}

function LegacyMailSettings() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navState = useNavigationState();
  const agentSettingsTabs = useAgentSettingsTabs();
  const [activeSection, setActiveSection] = useState<string>("integrations");
  // Links use the redesigned routes in both Settings; today's tabs can't
  // resolve Mail's area paths (`/settings/app/rules`) on their own.
  const pathTab = legacyMailSettingsTabForPath(location.pathname);

  const mailTabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "drafting",
        label: t("settings.drafting"),
        icon: IconSignature,
        content: <DraftingSection />,
        keywords: "signature writing style compose reply draft",
      },
      {
        id: "snippets",
        label: t("settings.snippets"),
        icon: IconMessage2,
        content: <SnippetsSection />,
        keywords: "snippets templates canned responses shortcuts",
      },
      {
        id: "automations",
        label: t("settings.automations"),
        icon: IconBolt,
        group: "automation",
        content: <AutomationsSection />,
        keywords: "automations rules triggers events labels model",
      },
      {
        id: "ai-filter",
        label: t("settings.aiFilter"),
        icon: IconFilter,
        group: "automation",
        content: <AiFilterSection />,
        keywords:
          "ai filter spam auto label unwanted mail suggestions feedback",
      },
      {
        id: "gmail-filters",
        label: t("settings.gmailFilters"),
        icon: IconFilter,
        group: "integrations",
        content: <GmailFiltersSection />,
        keywords: "gmail filters import rules",
      },
      {
        id: "aliases",
        label: t("settings.aliases"),
        icon: IconUsers,
        content: <AliasesSection />,
        keywords: "aliases groups distribution lists recipients",
      },
      {
        id: "tracking",
        label: t("settings.tracking"),
        icon: IconChartBar,
        content: <TrackingSection />,
        keywords: "tracking opens clicks pixel analytics",
      },
      {
        id: "slack",
        label: t("settings.slack"),
        icon: IconBolt,
        group: "integrations",
        content: <SlackIntakeSection />,
        keywords: "slack intake integration webhook",
      },
    ],
    [t],
  );

  const extraTabs = useMemo<SettingsTabItem[]>(
    () => [...mailTabs, ...agentSettingsTabs],
    [agentSettingsTabs, mailTabs],
  );

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "mail-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  const validSectionIds = useMemo(() => {
    const ids = new Set<string>(["general", "account", "whats-new"]);
    for (const tab of extraTabs) ids.add(tab.id);
    return ids;
  }, [extraTabs]);

  // Deep links arrive as /settings?section=<id>. Adopt that section, then
  // strip the param so later tab switches aren't overridden by a stale query
  // value.
  useEffect(() => {
    const requested = searchParams.get("section");
    const section = legacyMailSettingsTab(requested) ?? requested;
    if (!section || !validSectionIds.has(section)) return;
    setActiveSection(section);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("section");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, validSectionIds]);

  // Keep app state aware of the visible settings section for the agent.
  useEffect(() => {
    navState.sync({ view: "settings", settingsSection: activeSection });
  }, [activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pathTab) {
    const next = new URLSearchParams(location.search);
    next.set("section", pathTab);
    return (
      <Navigate
        to={{ pathname: STANDARD_APP_ROUTES.settings, search: `?${next}` }}
        replace
      />
    );
  }

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      className="flex-1"
      generalLabel={t("settings.general")}
      whatsNewLabel={t("settings.whatsNew")}
      extraTabs={extraTabs}
      generalSearchEntries={generalSearchEntries}
      value={activeSection}
      onValueChange={setActiveSection}
      general={<GeneralSection />}
      whatsNew={<WhatsNewSection />}
    />
  );
}
