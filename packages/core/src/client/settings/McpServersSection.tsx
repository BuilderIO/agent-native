/**
 * <McpServersSection /> — lets the user connect remote MCP servers at
 * user scope (personal) or org scope (shared with the team). Lives in the
 * workspace settings panel and talks to `/_agent-native/mcp/servers`.
 *
 * Adds/removes hot-reload into the running MCP manager — no restart.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconUsers,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useOrg } from "../org/hooks.js";

const ENDPOINT = "/_agent-native/mcp/servers";

type Scope = "user" | "org";

interface ServerStatus {
  state: "connected" | "error" | "unknown";
  toolCount?: number;
  error?: string;
}

interface ClientServer {
  id: string;
  scope: Scope;
  name: string;
  url: string;
  headers?: Record<string, { set: true }>;
  description?: string;
  createdAt: number;
  mergedId: string;
  status: ServerStatus;
}

interface ListResponse {
  user: ClientServer[];
  org: ClientServer[];
  orgId: string | null;
  role: string | null;
}

export function McpServersSection() {
  const org = useOrg().data;
  const qc = useQueryClient();

  // Keying the query on (email, orgId) means switching orgs via useSwitchOrg
  // triggers a refetch automatically — the old cached entry stays around
  // under its old key, and the new key has no data, which forces the fetch.
  const queryKey = ["mcp-servers", org?.email ?? null, org?.orgId ?? null];
  const { data, error, isLoading } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(ENDPOINT, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return (await res.json()) as ListResponse;
    },
    staleTime: 10_000,
  });

  const reload = () => qc.invalidateQueries({ queryKey: ["mcp-servers"] });

  const hasOrg = !!org?.orgId;
  const canWriteOrg =
    hasOrg && (org?.role === "owner" || org?.role === "admin");

  const [scope, setScope] = useState<Scope>("user");
  useEffect(() => {
    // If the user has no org, lock to user scope.
    if (!hasOrg && scope === "org") setScope("user");
  }, [hasOrg, scope]);

  if (error) {
    return (
      <p className="text-[10px] text-red-500">
        Failed to load MCP servers: {(error as Error).message}
      </p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading…
      </div>
    );
  }

  const servers = scope === "user" ? data.user : data.org;

  return (
    <div className="space-y-2">
      {/* Scope tabs */}
      <div className="flex gap-1 rounded-md bg-accent/30 p-0.5">
        <ScopeTab
          active={scope === "user"}
          onClick={() => setScope("user")}
          icon={<IconUser size={10} />}
          label="Personal"
          count={data.user.length}
        />
        {hasOrg && (
          <ScopeTab
            active={scope === "org"}
            onClick={() => setScope("org")}
            icon={<IconUsers size={10} />}
            label={org?.orgName ? `Team (${org.orgName})` : "Team"}
            count={data.org.length}
          />
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {scope === "user"
          ? "Servers you add here are only available to you."
          : canWriteOrg
            ? "Servers shared with everyone in your organization."
            : "Servers shared with your organization. Only owners and admins can edit."}
      </p>

      {servers.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No servers connected yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              readOnly={scope === "org" && !canWriteOrg}
              onChanged={reload}
            />
          ))}
        </div>
      )}

      {(scope === "user" || canWriteOrg) && (
        <AddServerForm scope={scope} onAdded={reload} />
      )}
    </div>
  );
}

function ScopeTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
      <span className="text-muted-foreground">({count})</span>
    </button>
  );
}

function ServerCard({
  server,
  readOnly,
  onChanged,
}: {
  server: ClientServer;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | "delete" | "test">(null);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const setToastAndClear = (kind: "ok" | "err", text: string, ms = 2500) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), ms);
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy("delete");
    try {
      const res = await fetch(
        `${ENDPOINT}/${encodeURIComponent(server.id)}?scope=${server.scope}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setToastAndClear("err", err ?? `Remove failed (${res.status})`);
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (busy) return;
    setBusy("test");
    try {
      const res = await fetch(
        `${ENDPOINT}/${encodeURIComponent(server.id)}/test?scope=${server.scope}`,
        { method: "POST", credentials: "include" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        toolCount?: number;
        error?: string;
      };
      if (res.ok && body.ok) {
        setToastAndClear(
          "ok",
          `Working — ${body.toolCount ?? 0} tool${body.toolCount === 1 ? "" : "s"}`,
        );
        onChanged();
      } else {
        setToastAndClear("err", body.error ?? "Test failed");
      }
    } finally {
      setBusy(null);
    }
  };

  const pill = useMemo(() => {
    if (server.status.state === "connected") {
      return (
        <span className="flex items-center gap-1 text-[10px] text-green-500">
          <IconCheck size={10} />
          {server.status.toolCount ?? 0} tool
          {(server.status.toolCount ?? 0) === 1 ? "" : "s"}
        </span>
      );
    }
    if (server.status.state === "error") {
      return (
        <span
          className="flex items-center gap-1 text-[10px] text-red-500"
          title={server.status.error}
        >
          <IconX size={10} />
          Error
        </span>
      );
    }
    return (
      <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Unknown
      </span>
    );
  }, [server.status]);

  return (
    <div className="rounded-md border border-border px-2.5 py-2 bg-accent/30">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-foreground truncate">
            {server.name}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {server.url}
          </p>
          {server.description && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {server.description}
            </p>
          )}
          {server.status.state === "error" && server.status.error && (
            <p className="text-[10px] text-red-500 mt-0.5 break-words">
              {server.status.error}
            </p>
          )}
          {server.headers && Object.keys(server.headers).length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {Object.keys(server.headers).length} auth header
              {Object.keys(server.headers).length === 1 ? "" : "s"} set
            </p>
          )}
        </div>
        <div className="shrink-0">{pill}</div>
      </div>
      {!readOnly && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleTest}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {busy === "test" ? (
              <IconLoader2 size={10} className="animate-spin" />
            ) : (
              "Test"
            )}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-red-500 disabled:opacity-40"
          >
            {busy === "delete" ? (
              <IconLoader2 size={10} className="animate-spin" />
            ) : (
              <>
                <IconTrash size={10} />
                Remove
              </>
            )}
          </button>
        </div>
      )}
      {toast && (
        <p
          className={`mt-1.5 text-[10px] ${
            toast.kind === "ok" ? "text-green-500" : "text-red-500"
          }`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}

function AddServerForm({
  scope,
  onAdded,
}: {
  scope: Scope;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setUrl("");
    setToken("");
    setDescription("");
    setError(null);
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token.trim()) headers["Authorization"] = `Bearer ${token.trim()}`;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          name: name.trim(),
          url: url.trim(),
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          description: description.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Add failed (${res.status})`);
        return;
      }
      reset();
      setOpen(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40"
      >
        <IconPlus size={10} />
        Add a remote MCP server
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border px-2.5 py-2 bg-accent/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-foreground">
          Add remote MCP server
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <IconX size={12} />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. zapier, github, my-server)"
        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
      />
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://mcp.example.com/..."
        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
      />
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token (optional)"
        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <button
        type="button"
        onClick={handleAdd}
        disabled={!name.trim() || !url.trim() || busy}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
        style={{ backgroundColor: "#625DF5", color: "white" }}
      >
        {busy ? (
          <IconLoader2 size={10} className="animate-spin" />
        ) : (
          <>
            <IconPlus size={10} />
            Add server
          </>
        )}
      </button>
    </div>
  );
}
