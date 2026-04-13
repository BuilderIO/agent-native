import { useState, useEffect, useRef, useCallback } from "react";
import {
  IconPlugConnected,
  IconPlus,
  IconX,
  IconChevronLeft,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";

interface AgentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  description?: string;
}

function AgentDetail({
  agent,
  onBack,
  onDelete,
}: {
  agent: AgentInfo;
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(agent.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [agent.url]);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2"
      >
        <IconChevronLeft size={12} />
        Back
      </button>

      <div className="flex items-center gap-2 mb-3">
        <IconPlugConnected size={16} className="text-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground truncate">
            {agent.name}
          </div>
          {agent.description && (
            <div className="text-[10px] text-muted-foreground">
              {agent.description}
            </div>
          )}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] font-medium text-muted-foreground mb-1">
          A2A Endpoint
        </div>
        <div className="flex items-center gap-1">
          <code className="flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
            {agent.url}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="Copy URL"
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground mb-3">
        @-mention this agent in chat to send it tasks via the A2A protocol. It
        will use its own tools and skills to respond.
      </div>

      <button
        onClick={() => onDelete(agent.id)}
        className="w-full rounded-md border border-red-800/50 px-2 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-900/20"
      >
        Remove agent
      </button>
    </div>
  );
}

export function AgentsSection() {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (showAdd) {
      setName("");
      setUrl("");
      setDescription("");
      const t = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showAdd]);

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;

    const id = trimmedName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const agentJson = JSON.stringify(
      {
        id,
        name: trimmedName,
        description: description.trim() || undefined,
        url: trimmedUrl,
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

  const handleDelete = async (agentId: string) => {
    try {
      const res = await fetch(`/_agent-native/resources/${agentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedAgent(null);
        fetchAgents();
      }
    } catch {}
  };

  if (selectedAgent) {
    return (
      <AgentDetail
        agent={selectedAgent}
        onBack={() => setSelectedAgent(null)}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <div className="text-xs font-medium text-foreground">
            Connected Agents
          </div>
          <div className="text-[10px] text-muted-foreground">
            {loading
              ? "Loading..."
              : agents.length > 0
                ? `${agents.length} connected via A2A`
                : "Connect remote A2A agents"}
          </div>
        </div>
        <button
          onClick={() => {
            if (expanded || showAdd) {
              setExpanded(false);
              setShowAdd(false);
            } else {
              setExpanded(true);
            }
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
          title={expanded ? "Collapse" : "Manage agents"}
        >
          {expanded || showAdd ? <IconX size={12} /> : <IconPlus size={12} />}
        </button>
      </div>

      {(expanded || showAdd) && (
        <>
          {!showAdd && (
            <div className="flex flex-col gap-0.5 mb-1.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/30"
                >
                  <IconPlugConnected
                    size={13}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-foreground truncate">
                      {agent.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">
                      {agent.url}
                    </div>
                  </div>
                </button>
              ))}
              <button
                onClick={() => setShowAdd(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/30"
              >
                <IconPlus size={12} className="shrink-0" />
                Add agent
              </button>
            </div>
          )}

          {showAdd && (
            <div className="mb-1.5 flex flex-col gap-1.5 rounded-md border border-border bg-background p-2">
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setShowAdd(false);
                }}
                className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="Name"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setShowAdd(false);
                }}
                className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="URL (e.g. http://localhost:8085)"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setShowAdd(false);
                }}
                className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="Description (optional)"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => setShowAdd(false)}
                  className="rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!name.trim() || !url.trim()}
                  className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
