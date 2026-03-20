import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  IconUsers,
  IconPlus,
  IconPencil,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  useAliases,
  useCreateAlias,
  useUpdateAlias,
  useDeleteAlias,
} from "@/hooks/use-aliases";
import type { Alias } from "@shared/types";

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
  const [emailsText, setEmailsText] = useState(
    alias?.emails.join("\n") ?? "",
  );

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
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Design team"
          className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          Recipients (one email per line)
        </label>
        <textarea
          value={emailsText}
          onChange={(e) => setEmailsText(e.target.value)}
          placeholder={"alice@example.com\nbob@example.com"}
          rows={4}
          className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors resize-none font-mono"
        />
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !emailsText.trim() || isPending}
          className="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending && (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          Cancel
        </button>
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
    if (
      window.confirm(
        `Delete alias "${alias.name}"? This cannot be undone.`,
      )
    ) {
      deleteAlias.mutate(alias.id);
    }
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
    <div
      ref={rowRef}
      className="flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3 group hover:border-border/60 transition-colors"
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
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
          title="Edit alias"
        >
          <IconPencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleteAlias.isPending}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
          title="Delete alias"
        >
          {deleteAlias.isPending ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconTrash className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
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
    <div className="flex-1 p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            Aliases
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Address groups you can use when composing emails.
          </p>
        </div>
        <button
          onClick={() => {
            setShowNewForm(true);
            setEditingId(null);
          }}
          className="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-400 transition-colors"
        >
          <IconPlus className="h-3.5 w-3.5" />
          New alias
        </button>
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
        {isLoading && (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground/50">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">Loading aliases…</span>
          </div>
        )}

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

// ─── Settings Page ────────────────────────────────────────────────────────────

type SettingsSection = "aliases";

const navItems: {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [{ id: "aliases", label: "Aliases", icon: IconUsers }];

export function SettingsPage() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("aliases");

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left sidebar nav */}
      <div className="w-[200px] shrink-0 border-r border-border/30 bg-[hsl(220,6%,5%)] p-3 flex flex-col gap-0.5">
        <p className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">
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
                "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] transition-colors text-left",
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
        {activeSection === "aliases" && <AliasesSection />}
      </div>
    </div>
  );
}
