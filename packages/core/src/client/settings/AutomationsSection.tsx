import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  IconBolt,
  IconClock,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { sendToAgentChat } from "../agent-chat.js";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  kind?: string;
  children?: TreeNode[];
  resource?: {
    id: string;
    path: string;
    owner: string;
    mimeType: string;
    size: number;
    createdAt: number;
    updatedAt: number;
  };
  jobMeta?: {
    schedule?: string;
    scheduleDescription?: string;
    enabled?: boolean;
    lastStatus?: string;
    lastRun?: string;
    nextRun?: string;
  };
}

interface AutomationItem {
  id: string;
  name: string;
  path: string;
  schedule?: string;
  scheduleDescription?: string;
  enabled: boolean;
  lastStatus?: string;
  lastRun?: string;
  nextRun?: string;
}

function flattenJobs(nodes: TreeNode[]): AutomationItem[] {
  const items: AutomationItem[] = [];
  for (const node of nodes) {
    if (node.type === "folder" && node.children) {
      items.push(...flattenJobs(node.children));
    }
    if (
      node.type === "file" &&
      node.kind === "job" &&
      node.resource &&
      node.jobMeta
    ) {
      const name = node.name.replace(/\.md$/, "").replace(/-/g, " ");
      items.push({
        id: node.resource.id,
        name,
        path: node.resource.path,
        schedule: node.jobMeta.schedule,
        scheduleDescription: node.jobMeta.scheduleDescription,
        enabled: node.jobMeta.enabled ?? false,
        lastStatus: node.jobMeta.lastStatus,
        lastRun: node.jobMeta.lastRun,
        nextRun: node.jobMeta.nextRun,
      });
    }
  }
  return items;
}

export function AutomationsSection() {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const showToast = useCallback(
    (kind: "ok" | "err", text: string, ms = 2500) => {
      setToast({ kind, text });
      setTimeout(() => setToast(null), ms);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/_agent-native/resources/tree")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return (await r.json()) as { tree: TreeNode[] };
      })
      .then(({ tree }) => {
        if (cancelled) return;
        const jobsFolder = tree.find(
          (n) => n.name === "jobs" && n.type === "folder",
        );
        const items = jobsFolder?.children
          ? flattenJobs(jobsFolder.children)
          : [];
        setAutomations(items);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const handleToggle = useCallback(
    async (item: AutomationItem) => {
      setTogglingId(item.id);
      try {
        const res = await fetch(
          `/_agent-native/resources/${encodeURIComponent(item.id)}`,
        );
        if (!res.ok) {
          showToast("err", "Failed to read automation");
          return;
        }
        const resource = await res.json();
        const content: string = resource.content ?? "";

        const newEnabled = !item.enabled;
        const updated = content.replace(
          /^(enabled:\s*)(true|false)/m,
          `$1${newEnabled}`,
        );

        const putRes = await fetch(
          `/_agent-native/resources/${encodeURIComponent(item.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: updated }),
          },
        );
        if (!putRes.ok) {
          showToast("err", "Failed to update automation");
          return;
        }
        showToast("ok", newEnabled ? "Enabled" : "Disabled");
        reload();
      } finally {
        setTogglingId(null);
      }
    },
    [reload, showToast],
  );

  const handleDelete = useCallback(
    async (item: AutomationItem) => {
      setDeletingId(item.id);
      try {
        const res = await fetch(
          `/_agent-native/resources/${encodeURIComponent(item.id)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          showToast("err", "Failed to delete automation");
          return;
        }
        showToast("ok", "Deleted");
        setConfirmDeleteId(null);
        reload();
      } finally {
        setDeletingId(null);
      }
    },
    [reload, showToast],
  );

  const handleFireTestEvent = useCallback(async () => {
    showToast("ok", "Firing test event...");
    try {
      const res = await fetch("/_agent-native/automations/fire-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: {} }),
      });
      if (!res.ok) {
        showToast("err", `Failed to fire event (${res.status})`);
        return;
      }
      showToast("ok", "Event fired");
    } catch (err: any) {
      showToast("err", err?.message ?? "Failed to fire event");
    }
  }, [showToast]);

  const [newOpen, setNewOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newScope, setNewScope] = useState<"personal" | "organization">(
    "personal",
  );
  const newPopoverRef = useRef<HTMLDivElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!newOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        newPopoverRef.current &&
        !newPopoverRef.current.contains(e.target as Node) &&
        newButtonRef.current &&
        !newButtonRef.current.contains(e.target as Node)
      ) {
        setNewOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [newOpen]);

  // Close popover on Escape
  useEffect(() => {
    if (!newOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNewOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [newOpen]);

  const handleNewSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!newPrompt.trim()) return;
      window.dispatchEvent(
        new CustomEvent("agent-panel:set-mode", {
          detail: { mode: "chat" },
        }),
      );
      sendToAgentChat({
        message: newPrompt.trim(),
        context: `The user wants to create a new automation. Scope: ${newScope}. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`,
        submit: true,
      });
      setNewPrompt("");
      setNewOpen(false);
    },
    [newPrompt, newScope],
  );

  if (error) {
    return (
      <p className="text-[10px] text-red-500">
        Failed to load automations: {error}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <button
            ref={newButtonRef}
            type="button"
            onClick={() => setNewOpen(!newOpen)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            <IconPlus size={10} />
            New Automation
          </button>
          {newOpen && (
            <div
              ref={newPopoverRef}
              className="absolute left-0 top-full mt-1.5 z-[220] w-72 rounded-lg border border-border bg-popover p-3 shadow-lg"
            >
              <form onSubmit={handleNewSubmit}>
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Describe what you want to automate..."
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring/50 min-h-[100px]"
                  autoFocus
                  required
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (newPrompt.trim()) handleNewSubmit(e);
                    }
                  }}
                />
                <div className="mt-2">
                  <select
                    value={newScope}
                    onChange={(e) =>
                      setNewScope(e.target.value as "personal" | "organization")
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-[12px] text-foreground"
                  >
                    <option value="personal">Personal</option>
                    <option value="organization">Organization</option>
                  </select>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <button
                    type="submit"
                    disabled={!newPrompt.trim()}
                    className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleFireTestEvent}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          <IconPlayerPlay size={10} />
          Fire Test Event
        </button>
      </div>

      {automations.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No automations yet. Click "New Automation" to create one, or ask the
          agent to set up a scheduled or event-triggered task.
        </p>
      ) : (
        automations.map((item) => (
          <div
            key={item.id}
            className="rounded-md border border-border px-2.5 py-2 bg-accent/30"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground shrink-0">
                    {item.schedule ? (
                      <IconClock size={11} />
                    ) : (
                      <IconBolt size={11} />
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-foreground truncate capitalize">
                    {item.name}
                  </span>
                </div>
                {item.scheduleDescription && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 ml-[17px]">
                    {item.scheduleDescription}
                  </p>
                )}
                {item.schedule && !item.scheduleDescription && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 ml-[17px] font-mono">
                    {item.schedule}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <StatusBadge status={item.lastStatus} />
                <button
                  type="button"
                  onClick={() => handleToggle(item)}
                  disabled={togglingId === item.id}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                    item.enabled
                      ? "bg-green-500/15 text-green-500"
                      : "bg-accent/60 text-muted-foreground"
                  } hover:opacity-80 disabled:opacity-40`}
                  title={item.enabled ? "Disable" : "Enable"}
                >
                  {togglingId === item.id ? (
                    <IconLoader2 size={10} className="animate-spin" />
                  ) : item.enabled ? (
                    "On"
                  ) : (
                    "Off"
                  )}
                </button>
                {confirmDeleteId === item.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      {deletingId === item.id ? (
                        <IconLoader2 size={10} className="animate-spin" />
                      ) : (
                        "Confirm"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-accent/60 text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(item.id)}
                    className="text-muted-foreground hover:text-red-500 disabled:opacity-40"
                    title="Delete"
                  >
                    <IconTrash size={12} />
                  </button>
                )}
              </div>
            </div>
            {item.lastRun && (
              <p className="text-[10px] text-muted-foreground mt-1 ml-[17px]">
                Last run:{" "}
                {new Date(item.lastRun).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        ))
      )}

      {toast && (
        <p
          className={`text-[10px] ${toast.kind === "ok" ? "text-green-500" : "text-red-500"}`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;

  const styles: Record<string, string> = {
    success: "bg-green-500/15 text-green-500",
    error: "bg-red-500/15 text-red-500",
    running: "bg-blue-500/15 text-blue-500",
    skipped: "bg-accent/60 text-muted-foreground",
  };

  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[status] ?? styles.skipped}`}
    >
      {status}
    </span>
  );
}
