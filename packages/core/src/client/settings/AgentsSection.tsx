import { useState, useEffect, useRef, useCallback } from "react";
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconCheck,
  IconX,
} from "@tabler/icons-react";

interface AgentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  description?: string;
}

function AgentEditPopover({
  agent,
  onSave,
  onDelete,
  onClose,
}: {
  agent: AgentInfo;
  onSave: (agent: AgentInfo) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [url, setUrl] = useState(agent.url);
  const [description, setDescription] = useState(agent.description ?? "");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    onSave({
      ...agent,
      name: name.trim(),
      url: url.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <div className="flex flex-col gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Name"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="URL (e.g. http://localhost:8085)"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Description (optional)"
        />
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={() => onDelete(agent.id)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/20"
          >
            <IconTrash size={10} />
            Remove
          </button>
          <div className="flex gap-1">
            <button
              onClick={onClose}
              className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !url.trim()}
              className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentAddPopover({
  onAdd,
  onClose,
}: {
  onAdd: (name: string, url: string, description: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleAdd = () => {
    if (!name.trim() || !url.trim()) return;
    onAdd(name.trim(), url.trim(), description.trim());
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <div className="flex flex-col gap-1.5">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Name"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="URL (e.g. http://localhost:8085)"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Description (optional)"
        />
        <div className="flex justify-end gap-1 pt-0.5">
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!name.trim() || !url.trim()}
            className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentsSection() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/resources?scope=all");
      if (!res.ok) return;
      const data = await res.json();
      const agentResources = (data.resources ?? []).filter(
        (r: { path: string }) =>
          r.path.startsWith("agents/") && r.path.endsWith(".json"),
      );
      const parsed = await Promise.all(
        agentResources.map(async (r: { id: string; path: string }) => {
          try {
            const detail = await fetch(`/_agent-native/resources/${r.id}`);
            if (!detail.ok) return null;
            const d = await detail.json();
            const config = JSON.parse(d.content);
            return {
              id: r.id,
              path: r.path,
              name: config.name,
              url: config.url,
              description: config.description,
            };
          } catch {
            return null;
          }
        }),
      );
      setAgents(parsed.filter(Boolean));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleAdd = async (name: string, url: string, description: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const agentJson = JSON.stringify(
      {
        id,
        name,
        description: description || undefined,
        url,
        color: "#6B7280",
      },
      null,
      2,
    );

    try {
      const res = await fetch("/_agent-native/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `agents/${id}.json`,
          content: agentJson,
          shared: true,
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        fetchAgents();
      }
    } catch {}
  };

  const handleSave = async (agent: AgentInfo) => {
    const agentJson = JSON.stringify(
      {
        id: agent.path.replace("agents/", "").replace(".json", ""),
        name: agent.name,
        description: agent.description || undefined,
        url: agent.url,
        color: "#6B7280",
      },
      null,
      2,
    );

    try {
      const res = await fetch(`/_agent-native/resources/${agent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: agentJson }),
      });
      if (res.ok) {
        setEditingAgent(null);
        fetchAgents();
      }
    } catch {}
  };

  const handleDelete = async (agentId: string) => {
    try {
      const res = await fetch(`/_agent-native/resources/${agentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEditingAgent(null);
        fetchAgents();
      }
    } catch {}
  };

  return (
    <div>
      {/* Header with + button */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-muted-foreground">
          @-mention agents in chat to delegate tasks via A2A.
        </div>
        <div className="relative">
          <button
            onClick={() => {
              setShowAdd(!showAdd);
              setEditingAgent(null);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="Add agent"
          >
            {showAdd ? <IconX size={12} /> : <IconPlus size={12} />}
          </button>
          {showAdd && (
            <AgentAddPopover
              onAdd={handleAdd}
              onClose={() => setShowAdd(false)}
            />
          )}
        </div>
      </div>

      {/* Agent list */}
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-6 w-full rounded bg-muted/50 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-muted/50 animate-pulse" />
        </div>
      ) : agents.length === 0 ? (
        <button
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/30"
        >
          <IconPlus size={12} className="shrink-0" />
          Add agent
        </button>
      ) : (
        <div className="flex flex-col gap-0.5">
          {agents.map((agent) => (
            <div key={agent.id} className="group relative">
              <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/30">
                <span className="text-[11px] font-medium text-foreground truncate shrink-0">
                  {agent.name}
                </span>
                <span className="flex-1 text-[10px] text-muted-foreground/60 truncate text-right">
                  {agent.url}
                </span>
                <button
                  onClick={() => {
                    setEditingAgent(
                      editingAgent === agent.id ? null : agent.id,
                    );
                    setShowAdd(false);
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-accent/50"
                  title="Edit agent"
                >
                  <IconPencil size={11} />
                </button>
              </div>
              {editingAgent === agent.id && (
                <AgentEditPopover
                  agent={agent}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onClose={() => setEditingAgent(null)}
                />
              )}
            </div>
          ))}
          <button
            onClick={() => {
              setShowAdd(true);
              setEditingAgent(null);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/30"
          >
            <IconPlus size={12} className="shrink-0" />
            Add agent
          </button>
        </div>
      )}
    </div>
  );
}
