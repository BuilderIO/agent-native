import {
  agentNativePath,
  useActionMutation,
  useChatModels,
  useChangeVersions,
  ChangelogSettingsCard,
  LanguagePicker,
  useAgentSettingsTabs,
  useT,
} from "@agent-native/core/client";
import { appApiPath } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
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
  IconFilter,
  IconInfoCircle,
  IconHistory,
  IconSettings,
  IconMessage2,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { GmailFiltersSection } from "@/components/settings/GmailFiltersSection";
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

function AliasesSection() {
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

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("settings.aliases")}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("settings.aliasesDescription")}
          </p>
        </div>
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
      </div>

      {/* Content */}
      <div className="max-w-2xl space-y-2">
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
            <SelectTrigger className="h-8 w-[140px] text-[13px]">
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
              value={action.labelName}
              onChange={(e) =>
                updateAction(idx, { type: "label", labelName: e.target.value })
              }
              placeholder={t("settings.labelName")}
              className="flex-1 h-8 px-2 text-[13px] placeholder:text-muted-foreground/40"
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
        <Switch
          checked={rule.enabled}
          onCheckedChange={handleToggle}
          className="scale-90"
        />
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
      // Filter to mail domain triggers only (event-based)
      return all.filter(
        (t) =>
          t.domain === "mail" ||
          (t.triggerType === "event" && t.event && t.event.startsWith("mail.")),
      );
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

function AutomationsSection() {
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
  const { data: autoSettings } = useQuery({
    queryKey: ["automation-settings", settingsSync],
    queryFn: async () => {
      const res = await fetch(appApiPath("/api/automations/settings"));
      if (!res.ok) return { engine: "anthropic", model: defaultModel };
      return res.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
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

  const handleModelChange = async (value: string) => {
    const [engine, model] = value.split("::");
    if (!engine || !model) return;
    queryClient.setQueryData(["automation-settings"], { engine, model });
    await fetch(appApiPath("/api/automations/settings"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, model }),
    });
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

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
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
        <div className="flex items-center gap-2">
          <Select
            value={selectedValue}
            onValueChange={handleModelChange}
            disabled={modelOptions.length === 0}
          >
            <SelectTrigger className="w-[260px] h-8 text-xs">
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
        </div>
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
      </div>

      {/* Content */}
      <div className="max-w-2xl space-y-2">
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
        {!isLoading && rules.length === 0 && !showNewForm && (
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
        {rules.map((rule) => (
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

function DraftingSection() {
  const t = useT();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const [signature, setSignature] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
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

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
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
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        ) : (
          <>
            <div className="rounded-lg border border-border/20 bg-card/50 p-4">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("settings.signature")}
                </label>
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
              </div>
              <Textarea
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                placeholder={"Best,\nSteve"}
                rows={5}
                className="resize-none px-3 py-2 text-[13px] placeholder:text-muted-foreground/40"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                {t("settings.signatureHelp")}
              </p>
            </div>

            <div className="rounded-lg border border-border/20 bg-card/50 p-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.writingStyle")}
              </label>
              <Textarea
                value={writingStyle}
                onChange={(event) => setWritingStyle(event.target.value)}
                placeholder={t("settings.writingStylePlaceholder")}
                rows={4}
                className="resize-none px-3 py-2 text-[13px] placeholder:text-muted-foreground/40"
              />
            </div>

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
          </>
        )}
      </div>
    </div>
  );
}

function TrackingRow({
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

function TrackingSection() {
  const t = useT();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const tracking = settings?.tracking ?? { opens: false, clicks: false };

  const update = (patch: Partial<{ opens: boolean; clicks: boolean }>) => {
    updateSettings.mutate({
      tracking: { ...tracking, ...patch },
    });
  };

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
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
            <TrackingRow
              title={t("settings.trackEmailOpens")}
              description={t("settings.trackEmailOpensDescription")}
              checked={tracking.opens}
              onCheckedChange={(v) => update({ opens: v })}
            />
            <TrackingRow
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">
          {t("settings.general")}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.generalDescription")}
        </p>
      </div>

      <div className="max-w-2xl rounded-lg border border-border/20 bg-card/50 p-4">
        <div className="mb-3">
          <h3 className="text-[13px] font-semibold text-foreground">
            {t("settings.languageTitle")}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t("settings.languageDescription")}
          </p>
        </div>
        <div className="max-w-sm">
          <LanguagePicker label={t("settings.languageLabel")} />
        </div>
      </div>
    </div>
  );
}

function WhatsNewSection() {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
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

type SettingsNavItem = {
  id: string;
  labelKey?: string;
  label?: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: SettingsNavItem[] = [
  { id: "general", labelKey: "settings.general", icon: IconSettings },
  { id: "team", labelKey: "settings.team", icon: IconUsers },
  { id: "whats-new", labelKey: "settings.whatsNew", icon: IconHistory },
  { id: "drafting", labelKey: "settings.drafting", icon: IconSignature },
  { id: "snippets", labelKey: "settings.snippets", icon: IconMessage2 },
  { id: "automations", labelKey: "settings.automations", icon: IconBolt },
  { id: "gmail-filters", labelKey: "settings.gmailFilters", icon: IconFilter },
  { id: "aliases", labelKey: "settings.aliases", icon: IconUsers },
  { id: "tracking", labelKey: "settings.tracking", icon: IconChartBar },
  { id: "slack", labelKey: "settings.slack", icon: IconBolt },
];

export function SettingsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const navState = useNavigationState();
  const agentSettingsTabs = useAgentSettingsTabs();
  const [activeSection, setActiveSection] = useState<string>("general");
  const allNavItems = useMemo<SettingsNavItem[]>(
    () => [
      ...navItems,
      ...agentSettingsTabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        icon: tab.icon ?? IconSettings,
      })),
    ],
    [agentSettingsTabs],
  );

  useEffect(() => {
    const section = searchParams.get("section");
    if (!section || !allNavItems.some((item) => item.id === section)) return;
    setActiveSection(section);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("section");
      return next;
    });
  }, [allNavItems, searchParams, setSearchParams]);

  useEffect(() => {
    navState.sync({ view: "settings", settingsSection: activeSection });
  }, [activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 flex-col sm:flex-row overflow-hidden">
      {/* Top tabs on mobile, left sidebar on desktop */}
      <div className="sm:w-[200px] shrink-0 sm:border-e border-b sm:border-b-0 border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)] sm:p-3 flex sm:flex-col gap-0.5 overflow-x-auto">
        {allNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          const label = item.labelKey
            ? t(item.labelKey)
            : (item.label ?? item.id);
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center gap-2.5 sm:w-full rounded-md px-3 sm:px-2.5 py-2.5 sm:py-2 text-[13px] transition-colors text-start whitespace-nowrap",
                isActive
                  ? "bg-blue-500/15 text-blue-400 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-blue-400" : "text-muted-foreground/60",
                )}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* Right content panel */}
      <div className="flex flex-1 overflow-hidden bg-background">
        {activeSection === "general" && <GeneralSection />}
        {activeSection === "whats-new" && <WhatsNewSection />}
        {activeSection === "drafting" && <DraftingSection />}
        {activeSection === "snippets" && <SnippetsSection />}
        {activeSection === "automations" && <AutomationsSection />}
        {activeSection === "gmail-filters" && <GmailFiltersSection />}
        {activeSection === "aliases" && <AliasesSection />}
        {activeSection === "tracking" && <TrackingSection />}
        {activeSection === "slack" && <SlackIntakeSection />}
        {activeSection === "team" && (
          <div className="flex-1 overflow-y-auto">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("settings.teamDescription")}
            />
          </div>
        )}
        {agentSettingsTabs.map((tab) =>
          activeSection === tab.id ? (
            <div key={tab.id} className="flex-1 overflow-y-auto p-4 sm:p-8">
              {tab.content}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
