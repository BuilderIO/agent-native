import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import type { Alias, AutomationAction, AutomationRule } from "@shared/types";
import { TeamPage } from "@agent-native/core/client/org";

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
          Alias name
        </label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Design team"
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          Recipients (one email per line)
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
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
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
              {alias.emails.length === 1 ? "person" : "people"}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground truncate">
            {alias.emails.join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="h-7 w-7 p-0"
            title="Edit alias"
          >
            <IconPencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteAlias.isPending}
            className="h-7 w-7 p-0"
            title="Delete alias"
          >
            {deleteAlias.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconTrash className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete alias</AlertDialogTitle>
            <AlertDialogDescription>
              Delete alias "{alias.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Aliases Section ──────────────────────────────────────────────────────────

function AliasesSection() {
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
          <h2 className="text-[16px] font-semibold text-foreground">Aliases</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Address groups you can use when composing emails.
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
          New alias
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
              No aliases yet. Create one to get started.
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
  { value: "label", label: "Apply label" },
  { value: "archive", label: "Archive" },
  { value: "mark_read", label: "Mark as read" },
  { value: "star", label: "Star" },
  { value: "trash", label: "Trash" },
] as const;

function ActionBuilder({
  actions,
  onChange,
}: {
  actions: AutomationAction[];
  onChange: (actions: AutomationAction[]) => void;
}) {
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
              {ACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
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
              placeholder="Label name"
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
        + Add action
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
          Rule name
        </label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Auto-label newsletters"
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          Condition (natural language)
        </label>
        <Textarea
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder={
            'e.g. "from a newsletter or marketing mailing list"\n"from alice@example.com"\n"subject contains invoice or receipt"'
          }
          rows={3}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40 resize-none"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          Actions
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
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
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
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="h-7 w-7 p-0"
          title="Edit rule"
        >
          <IconPencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => deleteAutomation.mutate(rule.id)}
          disabled={deleteAutomation.isPending}
          className="h-7 w-7 p-0"
          title="Delete rule"
        >
          {deleteAutomation.isPending ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconTrash className="h-3.5 w-3.5" />
          )}
        </Button>
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
  const { data: triggers = [], isLoading } = useQuery<FrameworkTrigger[]>({
    queryKey: ["framework-triggers-mail"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/automations");
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
          No event-triggered automations for mail yet.
        </p>
        <p className="text-[11px] text-muted-foreground/30 max-w-xs mx-auto mt-1">
          Ask the agent to create an automation like "when I receive an email
          from my boss, star it and notify me."
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {triggers.map((t) => {
        const StatusIcon =
          t.lastStatus === "success"
            ? IconCircleCheck
            : t.lastStatus === "error"
              ? IconCircleX
              : t.lastStatus === "running"
                ? IconLoader2
                : IconClock;
        const statusColor =
          t.lastStatus === "success"
            ? "text-green-400"
            : t.lastStatus === "error"
              ? "text-red-400"
              : t.lastStatus === "running"
                ? "text-yellow-400 animate-spin"
                : "text-muted-foreground/40";

        return (
          <div
            key={t.id}
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
                    t.enabled ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {t.name}
                </span>
                {!t.enabled && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50">
                    disabled
                  </span>
                )}
              </div>
              {t.event && (
                <p className="text-[11px] text-muted-foreground/60 mb-0.5">
                  on{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                    {t.event}
                  </code>
                  {t.condition && (
                    <span>
                      {" "}
                      when <em>"{t.condition}"</em>
                    </span>
                  )}
                </p>
              )}
              <p className="text-[12px] text-muted-foreground line-clamp-2">
                {t.body}
              </p>
              {t.lastRun && (
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  Last run:{" "}
                  {new Date(t.lastRun).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  {t.lastError && (
                    <span className="text-red-400"> — {t.lastError}</span>
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

const AUTOMATION_MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fastest)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
];

function AutomationsSection() {
  const { data: rules = [], isLoading } = useAutomations();
  const createAutomation = useCreateAutomation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const { data: autoSettings } = useQuery({
    queryKey: ["automation-settings"],
    queryFn: async () => {
      const res = await fetch("/api/automations/settings");
      if (!res.ok) return { model: "claude-haiku-4-5-20251001" };
      return res.json();
    },
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const handleModelChange = async (model: string) => {
    queryClient.setQueryData(["automation-settings"], { model });
    await fetch("/api/automations/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
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
            Automations
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Rules that automatically process new inbox emails using AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={autoSettings?.model || "claude-haiku-4-5-20251001"}
            onValueChange={handleModelChange}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">
                  {m.label}
                </SelectItem>
              ))}
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
          New rule
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
              No automation rules yet.
            </p>
            <p className="text-[12px] text-muted-foreground/30 max-w-sm mx-auto">
              Create rules to auto-label emails, archive newsletters, star
              important messages, and more. You can also ask the AI agent to set
              these up for you.
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
            Event Triggers
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Automations that fire when mail events occur (e.g. new email
            received). Managed by the agent.
          </p>
        </div>
        <TriggersSubsection />
      </div>
    </div>
  );
}

// ─── Tracking Section ────────────────────────────────────────────────────────

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
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const tracking = settings?.tracking ?? { opens: true, clicks: false };

  const update = (patch: Partial<{ opens: boolean; clicks: boolean }>) => {
    updateSettings.mutate({
      tracking: { ...tracking, ...patch },
    });
  };

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-foreground">Tracking</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Know when recipients open your sent emails and click links. Stats
          appear under each sent message.
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
              title="Track email opens"
              description="Inject a 1×1 pixel into outgoing emails so you can see when recipients open them."
              checked={tracking.opens}
              onCheckedChange={(v) => update({ opens: v })}
            />
            <TrackingRow
              title="Track link clicks"
              description="Rewrite external links in outgoing emails to count when recipients click them."
              checked={tracking.clicks}
              onCheckedChange={(v) => update({ clicks: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

type SettingsSection = "automations" | "aliases" | "tracking" | "team";

const navItems: {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "automations", label: "Automations", icon: IconBolt },
  { id: "aliases", label: "Aliases", icon: IconUsers },
  { id: "tracking", label: "Tracking", icon: IconChartBar },
  { id: "team", label: "Team", icon: IconUsers },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("automations");

  return (
    <div className="flex flex-1 flex-col sm:flex-row overflow-hidden">
      {/* Top tabs on mobile, left sidebar on desktop */}
      <div className="sm:w-[200px] shrink-0 sm:border-r border-b sm:border-b-0 border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)] sm:p-3 flex sm:flex-col gap-0.5 overflow-x-auto">
        <p className="hidden sm:block px-2 py-1.5 text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">
          Settings
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center gap-2.5 sm:w-full rounded-md px-3 sm:px-2.5 py-2.5 sm:py-2 text-[13px] transition-colors text-left whitespace-nowrap",
                isActive
                  ? "bg-indigo-500/15 text-indigo-300 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-indigo-400" : "text-muted-foreground/60",
                )}
              />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Right content panel */}
      <div className="flex flex-1 overflow-hidden bg-background">
        {activeSection === "automations" && <AutomationsSection />}
        {activeSection === "aliases" && <AliasesSection />}
        {activeSection === "tracking" && <TrackingSection />}
        {activeSection === "team" && (
          <div className="flex-1 overflow-y-auto">
            <TeamPage createOrgDescription="Set up a team to share email automations and settings with your colleagues." />
          </div>
        )}
      </div>
    </div>
  );
}
