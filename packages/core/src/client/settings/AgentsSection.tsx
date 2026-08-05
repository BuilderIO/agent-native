import { ButtonBase as ToolkitButtonBase } from "@agent-native/toolkit/ui/button";
import {
  IconPlus,
  IconTrash,
  IconX,
  IconCheck,
  IconLoader2,
  IconAlertTriangle,
  IconExternalLink,
  IconRefresh,
  IconTopologyRing2,
} from "@tabler/icons-react";
import { useState, useEffect, useRef, useCallback } from "react";

import {
  buildOpenRoutePath,
  buildSettingsRoute,
  STANDARD_SETTINGS_TABS,
} from "../../navigation/index.js";
import {
  getRemoteAgentIdFromPath,
  isRemoteAgentPath,
  REMOTE_AGENT_RESOURCE_PREFIX,
  remoteAgentResourcePath,
} from "../../resources/metadata.js";
import { agentNativePath, appBasePath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useOrg, useSyncA2ASecret } from "../org/hooks.js";

interface AgentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  description?: string;
}

/** Wire shape of `GET /_agent-native/agents/probe` (single or batched result). */
interface AgentProbeResult {
  url: string;
  reachable: boolean;
  name?: string;
  description?: string;
  securitySchemes?: string[];
  /** Absent (not false) whenever the auth check never ran or never resolved. */
  authorized?: boolean;
  authError?: string;
  publicSkills?: number;
  error?: string;
}

function describeSkills(publicSkills: number | undefined): string | null {
  if (publicSkills === undefined) return null;
  // An empty public skill list only means the card advertises no anonymous-
  // safe actions — the peer still has authenticated reads/writes. Saying so
  // plainly avoids reading as "this agent can't do anything."
  if (publicSkills === 0) return "reads require auth";
  return `${publicSkills} public skill${publicSkills === 1 ? "" : "s"}`;
}

/** One-line status for the row dot tooltip. */
function describeProbeTooltip(result: AgentProbeResult): string {
  if (!result.reachable) {
    return `Unreachable${result.error ? `: ${result.error}` : ""}`;
  }
  if (result.authorized === false) {
    return "Reachable, but the peer rejected our token — calls will 401 in production";
  }
  if (result.authorized === undefined) {
    return "Reachable; couldn't verify our token";
  }
  return "Reachable and authorized";
}

/** Multi-clause status line for the Add popover's Check result. */
function describeCheckResult(result: AgentProbeResult): string {
  if (!result.reachable) {
    return result.error ?? "Not reachable";
  }
  const scheme = result.securitySchemes?.length
    ? result.securitySchemes.join(", ")
    : "no auth scheme advertised";
  const authText =
    result.authorized === false
      ? "the peer rejected our token — calls will 401 in production"
      : result.authorized === undefined
        ? `couldn't verify our token${result.authError ? ` (${result.authError})` : ""}`
        : "our token works";
  const skills = describeSkills(result.publicSkills);
  return [`Live · ${scheme}`, authText, skills].filter(Boolean).join(" · ");
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
      className="absolute end-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
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

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; result: AgentProbeResult }
  | { status: "error"; message: string };

interface AddedAgentInfo {
  name: string;
  url: string;
  description: string;
}

/** Builds an absolute deep link into a peer's own Settings > Agents Add
 * popover, prefilled with THIS app's own name/url/description, via the
 * existing `/_agent-native/open` route's `f_*` filter-forwarding (the only
 * non-reserved params the open route echoes onto the redirect URL instead of
 * only stashing them server-side for `navigate` polling). No new endpoint. */
function buildPeerRegisterBackLink(peerUrl: string): string {
  const selfUrl = `${window.location.origin}${appBasePath()}`;
  const selfName = document.title.trim() || window.location.hostname;
  const openPath = buildOpenRoutePath({
    view: "settings",
    to: buildSettingsRoute(STANDARD_SETTINGS_TABS.agent),
    params: {
      f_agentName: selfName,
      f_agentUrl: selfUrl,
    },
  });
  return `${peerUrl.replace(/\/+$/, "")}${openPath}`;
}

function AgentAddPopover({
  initialName = "",
  initialUrl = "",
  initialDescription = "",
  secretSet,
  syncSecret,
  onAdd,
  onClose,
}: {
  initialName?: string;
  initialUrl?: string;
  initialDescription?: string;
  secretSet: boolean | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
  onAdd: (name: string, url: string, description: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [description, setDescription] = useState(initialDescription);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [added, setAdded] = useState<AddedAgentInfo | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(
      () => (urlRef.current?.value ? nameRef : urlRef).current?.focus(),
      50,
    );
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

  const handleCheck = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setCheck({ status: "checking" });
    try {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/agents/probe?url=${encodeURIComponent(trimmedUrl)}`,
        ),
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCheck({
          status: "error",
          message: body?.error ?? `Check failed (${res.status})`,
        });
        return;
      }
      const result = body as AgentProbeResult;
      setCheck({ status: "done", result });
      if (result.reachable) {
        if (!name.trim() && result.name) setName(result.name);
        if (!description.trim() && result.description) {
          setDescription(result.description);
        }
      }
    } catch (err: any) {
      setCheck({ status: "error", message: err?.message ?? "Check failed" });
    }
  }, [url, name, description]);

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;
    const trimmedDescription = description.trim();
    const ok = await onAdd(trimmedName, trimmedUrl, trimmedDescription);
    if (ok) {
      setAdded({
        name: trimmedName,
        url: trimmedUrl,
        description: trimmedDescription,
      });
    }
  };

  if (added) {
    return (
      <div
        ref={popoverRef}
        className="absolute end-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Added {added.name} on your side only — registration is one-way, so
            it won&apos;t know about this app until it&apos;s added there too.
          </p>
          <a
            href={buildPeerRegisterBackLink(added.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center justify-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground no-underline hover:bg-accent/80"
          >
            <IconExternalLink size={10} />
            Open {added.name}&apos;s settings
          </a>
          <button
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const result = check.status === "done" ? check.result : null;
  const unreachable = result ? !result.reachable : false;
  const unauthorized = result ? result.authorized === false : false;

  return (
    <div
      ref={popoverRef}
      className="absolute end-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          <input
            ref={urlRef}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setCheck({ status: "idle" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCheck();
              if (e.key === "Escape") onClose();
            }}
            className="w-full flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="URL (e.g. http://localhost:8085)"
          />
          <ToolkitButtonBase
            type="button"
            variant="outline"
            onClick={handleCheck}
            disabled={!url.trim() || check.status === "checking"}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
          >
            {check.status === "checking" ? (
              <IconLoader2 size={10} className="animate-spin" />
            ) : (
              "Check"
            )}
          </ToolkitButtonBase>
        </div>

        {check.status === "error" && (
          <p className="flex items-start gap-1 text-[10px] text-red-500">
            <IconAlertTriangle size={11} className="mt-px shrink-0" />
            {check.message}
          </p>
        )}
        {result && (
          <div
            className={`flex items-start gap-1 text-[10px] ${
              unreachable || unauthorized
                ? "text-amber-600 dark:text-amber-400"
                : "text-green-600 dark:text-green-500"
            }`}
          >
            {unreachable || unauthorized ? (
              <IconAlertTriangle size={11} className="mt-px shrink-0" />
            ) : (
              <IconCheck size={11} className="mt-px shrink-0" />
            )}
            <span className="leading-relaxed">
              {describeCheckResult(result)}
              {unreachable &&
                " — the app may just not be running yet; you can still add it."}
            </span>
          </div>
        )}
        {unauthorized &&
          (secretSet === true ? (
            <button
              onClick={() => syncSecret.mutate(undefined)}
              disabled={syncSecret.isPending}
              className="inline-flex cursor-pointer items-center gap-1 self-start rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {syncSecret.isPending ? (
                <IconLoader2 size={10} className="animate-spin" />
              ) : (
                <IconRefresh size={10} />
              )}
              Sync secret to apps
            </button>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {secretSet === false ? (
                <>
                  No shared secret set yet —{" "}
                  <a
                    href={buildSettingsRoute(STANDARD_SETTINGS_TABS.team)}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    set one on the Team page
                  </a>{" "}
                  first.
                </>
              ) : (
                "Ask your workspace owner to sync the shared secret."
              )}
            </p>
          ))}

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
            className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!name.trim() || !url.trim()}
            className="cursor-pointer rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
          >
            {unreachable ? "Add anyway" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function A2ASecretStatusRow({
  org,
  syncSecret,
}: {
  org: { a2aSecretSet?: boolean; allowedDomain: string | null } | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
}) {
  if (!org) return null;
  const secretSet = org.a2aSecretSet;

  if (secretSet === undefined) {
    // Not an owner/admin — the server omits `a2aSecretSet` entirely for this
    // role rather than reporting `false`, so this must read as "can't see
    // it," never as "not set" (a claim we have no basis for).
    return (
      <div className="mb-2 rounded-md border border-border/60 bg-accent/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        Shared secret is managed by your workspace owner.
      </div>
    );
  }

  if (!secretSet) {
    return (
      <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
        No shared secret set — connected apps will reject calls in production.{" "}
        <a
          href={buildSettingsRoute(STANDARD_SETTINGS_TABS.team)}
          className="underline underline-offset-2 hover:text-amber-500"
        >
          Set one on the Team page
        </a>
      </div>
    );
  }

  const noDomain = syncSecret.error?.message?.toLowerCase().includes("domain");
  const failures = syncSecret.data?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="mb-2 flex flex-col gap-1 rounded-md border border-border/60 bg-accent/20 px-2 py-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          Shared secret set
          {org.allowedDomain ? ` for ${org.allowedDomain}` : ""}
        </span>
        <button
          onClick={() => syncSecret.mutate(undefined)}
          disabled={syncSecret.isPending}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {syncSecret.isPending ? (
            <IconLoader2 size={10} className="animate-spin" />
          ) : (
            <IconRefresh size={10} />
          )}
          Sync to apps
        </button>
      </div>
      {syncSecret.data && !syncSecret.isPending && (
        <div className="text-muted-foreground">
          Synced to {syncSecret.data.succeeded}/{syncSecret.data.total} app
          {syncSecret.data.total === 1 ? "" : "s"}
          {syncSecret.data.failed > 0
            ? ` (${syncSecret.data.failed} failed)`
            : ""}
          .
          {failures.length > 0 && (
            <ul className="mt-0.5 list-disc ps-3 text-red-500">
              {failures.map((r) => (
                <li key={r.id}>
                  {r.name}: {r.error ?? `HTTP ${r.status ?? "?"}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {syncSecret.error && (
        <p className="text-red-500">
          {syncSecret.error.message}
          {noDomain && (
            <>
              {" "}
              <a
                href={buildSettingsRoute(STANDARD_SETTINGS_TABS.team)}
                className="underline underline-offset-2"
              >
                Set the domain
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Query params `/_agent-native/open` forwards onto the redirect target. */
const PREFILL_PARAMS = [
  "f_agentName",
  "f_agentUrl",
  "f_agentDescription",
] as const;

export function AgentsSection() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<{
    name: string;
    url: string;
    description: string;
  } | null>(null);
  const [probeById, setProbeById] = useState<Map<
    string,
    AgentProbeResult
  > | null>(null);

  const { data: org } = useOrg();
  const syncSecret = useSyncA2ASecret();

  // Landing from a peer's "register back" deep link (see
  // buildPeerRegisterBackLink): the open route only echoes `f_*` params onto
  // the redirect URL, so read those here and open the Add popover prefilled.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("f_agentUrl");
    if (!url) return;
    setPrefill({
      name: params.get("f_agentName") ?? "",
      url,
      description: params.get("f_agentDescription") ?? "",
    });
    setShowAdd(true);
    for (const key of PREFILL_PARAMS) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  // One batched probe for the whole list — cheap liveness dots, not one
  // request per row. A row absent from the results (never returned) stays
  // dot-less rather than defaulting to a color that isn't backed by data.
  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/agents/probe"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const results = Array.isArray(data.results)
          ? (data.results as Array<AgentProbeResult & { id: string }>)
          : [];
        const map = new Map<string, AgentProbeResult>();
        for (const result of results) map.set(result.id.toLowerCase(), result);
        setProbeById(map);
      })
      .catch(() => {
        if (!cancelled) setProbeById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/resources?scope=all"),
      );
      if (!res.ok) return;
      const data = await res.json();
      // Migrating a remote agent to the canonical `remote-agents/` prefix
      // leaves the legacy `agents/` row in place (resources/store.ts), so
      // every migrated agent has two resources pointing at one URL. Collapse
      // them the way discoverAgents does, canonical winning.
      const byAgentId = new Map<string, { id: string; path: string }>();
      for (const resource of (data.resources ?? []) as Array<{
        id: string;
        path: string;
      }>) {
        if (!isRemoteAgentPath(resource.path)) continue;
        const agentId = getRemoteAgentIdFromPath(resource.path);
        const existing = byAgentId.get(agentId);
        if (existing?.path.startsWith(REMOTE_AGENT_RESOURCE_PREFIX)) continue;
        byAgentId.set(agentId, resource);
      }
      const agentResources = [...byAgentId.values()];
      const parsed = await Promise.all(
        agentResources.map(async (r): Promise<AgentInfo | null> => {
          try {
            const detail = await fetch(
              agentNativePath(`/_agent-native/resources/${r.id}`),
            );
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
      setAgents(parsed.filter((agent): agent is AgentInfo => agent !== null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleAdd = async (
    name: string,
    url: string,
    description: string,
  ): Promise<boolean> => {
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
      const res = await fetch(agentNativePath("/_agent-native/resources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: remoteAgentResourcePath(id),
          content: agentJson,
          shared: true,
        }),
      });
      // Deliberately don't close the popover here — a successful add shows a
      // follow-up state (registration is one-way; the peer doesn't know
      // about us yet) that the user dismisses explicitly.
      if (res.ok) fetchAgents();
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleSave = async (agent: AgentInfo) => {
    const agentJson = JSON.stringify(
      {
        id: getRemoteAgentIdFromPath(agent.path),
        name: agent.name,
        description: agent.description || undefined,
        url: agent.url,
        color: "#6B7280",
      },
      null,
      2,
    );

    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/resources/${agent.id}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: agentJson }),
        },
      );
      if (res.ok) {
        setEditingAgent(null);
        fetchAgents();
      }
    } catch {}
  };

  const handleDelete = async (agentId: string) => {
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/resources/${agentId}`),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (res.ok) {
        setEditingAgent(null);
        fetchAgents();
      }
    } catch {}
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <div className="relative">
          <button
            onClick={() => {
              setShowAdd(!showAdd);
              setEditingAgent(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {showAdd ? <IconX size={13} /> : <IconPlus size={13} />}
            {showAdd ? "Cancel" : "Connect agent"}
          </button>
          {showAdd && (
            <AgentAddPopover
              initialName={prefill?.name}
              initialUrl={prefill?.url}
              initialDescription={prefill?.description}
              secretSet={org?.a2aSecretSet}
              syncSecret={syncSecret}
              onAdd={handleAdd}
              onClose={() => {
                setShowAdd(false);
                setPrefill(null);
              }}
            />
          )}
        </div>
      </div>

      <A2ASecretStatusRow org={org} syncSecret={syncSecret} />

      {/* Agent list */}
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-6 w-full rounded bg-muted/50 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-muted/50 animate-pulse" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-border/70 bg-card px-5 py-8 text-center">
          <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconTopologyRing2 size={17} />
          </span>
          <p className="text-sm font-medium text-foreground">
            No connected agents yet
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Connect an A2A agent to delegate work from chat.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconPlus size={13} />
            Connect agent
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
          <div className="divide-y divide-border/60 px-4">
            {agents.map((agent) => {
              const probe = probeById?.get(
                getRemoteAgentIdFromPath(agent.path).toLowerCase(),
              );
              const dotState: "ok" | "warn" | null = !probe
                ? null
                : probe.reachable && probe.authorized !== false
                  ? "ok"
                  : "warn";
              return (
                <div key={agent.id} className="group relative">
                  <div className="flex w-full items-center gap-3 py-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <IconTopologyRing2 size={15} />
                    </span>
                    {dotState ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              dotState === "ok"
                                ? "bg-primary"
                                : "bg-destructive"
                            }`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {probe && describeProbeTooltip(probe)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {agent.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {agent.url}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setEditingAgent(
                          editingAgent === agent.id ? null : agent.id,
                        );
                        setShowAdd(false);
                      }}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      Manage
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
