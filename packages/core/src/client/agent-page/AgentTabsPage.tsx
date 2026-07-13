import {
  IconBrain,
  IconClock,
  IconExternalLink,
  IconFolder,
  IconPlugConnected,
  IconSearch,
  IconShieldLock,
  IconX,
} from "@tabler/icons-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";

import {
  MCP_CONNECT_GUIDES,
  MCP_CONNECT_MCP_URL_TEMPLATE,
  MCP_STATIC_TOKEN_FALLBACK,
  interpolateMcpConnectTemplate,
  type McpConnectTemplateValues,
} from "../../shared/mcp-connect-content.js";
import { appPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import {
  McpIntegrationDialog,
  // The dialog is intentionally reused here so the Agent page remains a thin
  // host for the existing MCP management flow.
} from "../resources/McpIntegrationDialog.js";
import { McpServerDetail } from "../resources/McpServerDetail.js";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  type McpServer,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";
import { AgentsSection } from "../settings/AgentsSection.js";
import type {
  SettingsSearchEntry,
  SettingsTabItem,
} from "../settings/SettingsTabsPage.js";
import { cn } from "../utils.js";
import type { AgentPageScope, AgentPageTabProps } from "./types.js";

const AgentContextTab = lazy(() =>
  import("./AgentContextTab.js").then((module) => ({
    default: module.AgentContextTab,
  })),
);
const AgentJobsTab = lazy(() =>
  import("./AgentJobsTab.js").then((module) => ({
    default: module.AgentJobsTab,
  })),
);
const ResourcesPanel = lazy(() =>
  import("../resources/ResourcesPanel.js").then((module) => ({
    default: module.ResourcesPanel,
  })),
);

type SettingsTabIcon = ComponentType<{ className?: string }>;

function normalizeTabId(value?: string | null): string | null {
  const normalized = value
    ?.replace(/^#/, "")
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[\s_]+/g, "-");
  return normalized || null;
}

function resolveTabId(
  tabs: SettingsTabItem[],
  value?: string | null,
): string | null {
  const normalized = normalizeTabId(value);
  if (!normalized) return null;
  if (tabs.some((tab) => tab.id === normalized)) return normalized;
  const section = normalized.split(":", 1)[0];
  const owner = tabs.find((tab) =>
    tab.searchEntries?.some(
      (entry) => normalizeTabId(entry.hash ?? entry.id) === section,
    ),
  );
  return owner?.id ?? null;
}

function updateTabHash(tabId: string) {
  if (typeof window === "undefined") return;
  const hash = tabId === "context" ? "" : `#${encodeURIComponent(tabId)}`;
  window.history.pushState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}

function initialScope(): AgentPageScope {
  if (typeof window === "undefined") return "user";
  try {
    const queryScope = new URLSearchParams(window.location.search).get("scope");
    if (queryScope === "org" || queryScope === "user") return queryScope;
    return localStorage.getItem("agent-page-scope") === "org" ? "org" : "user";
  } catch {
    return "user";
  }
}

function updateScopeUrl(scope: AgentPageScope) {
  if (typeof window === "undefined") return;
  const search = new URLSearchParams(window.location.search);
  search.set("scope", scope);
  const query = search.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

function TabLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      <div className="h-20 animate-pulse rounded-lg border border-border bg-muted/30" />
      <div className="h-20 animate-pulse rounded-lg border border-border bg-muted/30" />
    </div>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/10">
      <span className="sr-only">{label}</span>
    </div>
  );
}

function FilesTab({ scope }: AgentPageTabProps) {
  return (
    <div className="h-full min-h-[360px]">
      <ResourcesPanel
        key={scope}
        showMcpServers={false}
        scope={scope === "org" ? "shared" : "personal"}
      />
    </div>
  );
}

function ScopeBadge({ scope }: { scope: McpServerScope }) {
  return (
    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {scope === "user" ? "Personal" : "Organization"}
    </span>
  );
}

function ServerStatus({ server }: { server: McpServer }) {
  if (server.status.state === "connected") {
    return (
      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
        Connected · {server.status.toolCount} tools
      </span>
    );
  }
  if (server.status.state === "error") {
    return (
      <span className="truncate text-[11px] text-destructive">
        Connection error
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground">Status unknown</span>
  );
}

function ConnectionsTab({ scope, canManageOrg = false }: AgentPageTabProps) {
  const t = useT();
  const serversQuery = useMcpServers();
  const createServer = useCreateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = serversQuery.data;
  const hasOrg = Boolean(data?.orgId);
  const canCreateOrgMcp = hasOrg && canManageOrg;
  const activeScope: McpServerScope = scope === "org" ? "org" : "user";

  const onCreateMcpServer = useCallback(
    async (args: {
      scope: McpServerScope;
      name: string;
      url: string;
      headers?: Record<string, string>;
      description?: string;
    }) => {
      if (args.scope === "org" && !canCreateOrgMcp) {
        throw new Error(
          "Only organization admins can add organization MCP servers.",
        );
      }
      return createServer.mutateAsync(args);
    },
    [canCreateOrgMcp, createServer],
  );

  const removeServer = async (server: McpServer) => {
    const key = `${server.scope}:${server.id}`;
    if (deleteTarget !== key) {
      setDeleteTarget(key);
      return;
    }
    setError(null);
    try {
      await deleteServer.mutateAsync({ id: server.id, scope: server.scope });
      if (
        selectedServer?.id === server.id &&
        selectedServer.scope === server.scope
      ) {
        setSelectedServer(null);
      }
      setDeleteTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const renderServer = (server: McpServer) => {
    const key = `${server.scope}:${server.id}`;
    const canDelete = server.scope === "user" || canManageOrg;
    const selected =
      selectedServer?.id === server.id && selectedServer.scope === server.scope;
    return (
      <div
        key={key}
        className={cn(
          "rounded-lg border border-border bg-card p-3 transition-colors",
          selected && "border-foreground/30 bg-accent/20",
        )}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setSelectedServer(selected ? null : server)}
            className="min-w-0 flex-1 cursor-pointer text-start"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {server.name}
              </span>
              <ScopeBadge scope={server.scope} />
              {server.scope === activeScope && (
                <span className="text-[10px] text-muted-foreground">
                  Selected scope
                </span>
              )}
            </div>
            <code className="mt-1 block truncate text-[11px] text-muted-foreground">
              {server.url}
            </code>
            <div className="mt-2 flex items-center gap-2">
              <ServerStatus server={server} />
              {server.description && (
                <span className="truncate text-[11px] text-muted-foreground/70">
                  {server.description}
                </span>
              )}
            </div>
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => void removeServer(server)}
              disabled={deleteServer.isPending}
              className={cn(
                "cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                deleteTarget === key && "bg-destructive/10 text-destructive",
              )}
            >
              {deleteTarget === key ? "Confirm" : "Delete"}
            </button>
          )}
        </div>
        {selected && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <McpServerDetail server={server} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              MCP servers
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Tools and services this agent can reach. The page scope controls
              where new servers are saved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDialogOpen(true);
            }}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("mcpIntegrations.connect")}
          </button>
        </div>
        {error && (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {serversQuery.isLoading ? (
          <TabLoading />
        ) : serversQuery.isError ? (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Could not load MCP servers.
          </p>
        ) : data && data.user.length + data.org.length > 0 ? (
          <div className="space-y-2">
            {data.user.map(renderServer)}
            {data.org.map(renderServer)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
            No MCP servers are connected yet.
          </div>
        )}
        <McpIntegrationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          defaultScope={activeScope}
          canCreateOrgMcp={canCreateOrgMcp}
          hasOrg={hasOrg}
          onCreateMcpServer={onCreateMcpServer}
        />
      </section>

      <section className="space-y-3 border-t border-border/70 pt-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Remote agents
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Other agents this app can call through A2A.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <AgentsSection />
        </div>
      </section>
    </div>
  );
}

interface AccessUrls {
  appName: string;
  appUrl: string;
  mcpUrl: string;
  connectUrl: string;
  agentCardUrl: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {label}
        </div>
        <code className="mt-1 block truncate text-xs text-foreground">
          {value}
        </code>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 cursor-pointer rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function AccessTab({
  appName: appNameProp,
}: AgentPageTabProps & { appName?: string }) {
  const [urls, setUrls] = useState<AccessUrls | null>(null);
  const [agentCardAvailable, setAgentCardAvailable] = useState(false);
  const [activeGuide, setActiveGuide] = useState(MCP_CONNECT_GUIDES[0]?.id);

  useEffect(() => {
    const origin = window.location.origin;
    const baseUrl = new URL(appPath("/"), origin).toString().replace(/\/$/, "");
    const hostname = window.location.hostname || "app";
    const metaSiteName = document
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content")
      ?.trim();
    const hostnameGuess =
      hostname !== "localhost" && hostname !== "127.0.0.1"
        ? hostname.split(".")[0]
        : "";
    const appName =
      appNameProp?.trim() || metaSiteName || hostnameGuess || "this app";
    const templateValues = {
      appName,
      appUrl: baseUrl,
      mcpUrl: "",
      serverId: `agent-native-${hostname}`,
    } satisfies McpConnectTemplateValues;
    setUrls({
      appName,
      appUrl: baseUrl,
      mcpUrl: interpolateMcpConnectTemplate(
        MCP_CONNECT_MCP_URL_TEMPLATE,
        templateValues,
      ),
      connectUrl: new URL(appPath("/mcp/connect"), origin).toString(),
      agentCardUrl: new URL(
        appPath("/.well-known/agent-card.json"),
        origin,
      ).toString(),
    });
  }, [appNameProp]);

  useEffect(() => {
    if (!urls) return;
    let cancelled = false;
    fetch(urls.agentCardUrl)
      .then((response) => {
        if (!cancelled) setAgentCardAvailable(response.ok);
      })
      .catch(() => {
        if (!cancelled) setAgentCardAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urls]);

  const templateValues: McpConnectTemplateValues | null = urls
    ? {
        appName: urls.appName,
        appUrl: urls.appUrl,
        mcpUrl: urls.mcpUrl,
        serverId: `agent-native-${window.location.hostname || "app"}`,
      }
    : null;
  const guide =
    MCP_CONNECT_GUIDES.find((item) => item.id === activeGuide) ??
    MCP_CONNECT_GUIDES[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Access</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Choose which external clients can talk to this app&apos;s agent and
          follow the setup for each one. Grants, scopes, and revocation will
          live here in a future pass.
        </p>
      </div>
      {urls ? (
        <>
          <CopyField label="MCP URL" value={urls.mcpUrl} />
          {agentCardAvailable && (
            <CopyField label="A2A agent card" value={urls.agentCardUrl} />
          )}
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Client setup
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                These instructions are also available on the full connect page.
              </p>
            </div>
            <div
              className="flex gap-1 overflow-x-auto border-b border-border pb-2"
              role="tablist"
              aria-label="Choose your AI assistant"
            >
              {MCP_CONNECT_GUIDES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === guide?.id}
                  onClick={() => setActiveGuide(item.id)}
                  className={cn(
                    "shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium",
                    item.id === guide?.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {guide && templateValues && (
              <div className="space-y-3 pt-1" role="tabpanel">
                {guide.steps?.length ? (
                  <ol className="list-decimal space-y-2 ps-5 text-xs leading-relaxed text-muted-foreground">
                    {guide.steps.map((step) => (
                      <li key={step}>
                        {interpolateMcpConnectTemplate(step, templateValues)}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {guide.intro && (
                  <p className="text-xs text-muted-foreground">
                    {interpolateMcpConnectTemplate(guide.intro, templateValues)}
                  </p>
                )}
                {guide.commandTemplate && (
                  <CopyField
                    label="Command"
                    value={interpolateMcpConnectTemplate(
                      guide.commandTemplate,
                      templateValues,
                    )}
                  />
                )}
                {guide.configTemplate && (
                  <CopyField
                    label="MCP config"
                    value={interpolateMcpConnectTemplate(
                      guide.configTemplate,
                      templateValues,
                    )}
                  />
                )}
                {guide.action?.kind === "link" && guide.action.href && (
                  <a
                    href={guide.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    {guide.action.label}
                    <IconExternalLink className="size-3.5" />
                  </a>
                )}
                {guide.note && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {interpolateMcpConnectTemplate(guide.note, templateValues)}
                  </p>
                )}
              </div>
            )}
          </section>
          <section className="rounded-lg border border-border/70 bg-muted/10 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {MCP_STATIC_TOKEN_FALLBACK.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {MCP_STATIC_TOKEN_FALLBACK.state}. Open the connect page to create
              a token for clients that cannot complete OAuth.
            </p>
            <a
              href={urls.connectUrl}
              className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              Open full connect page
              <IconExternalLink className="size-3.5" />
            </a>
          </section>
        </>
      ) : (
        <TabLoading />
      )}
    </div>
  );
}

export interface AgentTabsPageProps {
  /**
   * Human-readable app name used in the Access tab's connect instructions
   * (e.g. "name it Mail"). Falls back to the `og:site_name` meta tag, then a
   * hostname-derived guess — never `document.title`, which this page owns.
   */
  appName?: string;
  extraTabs?: SettingsTabItem[];
  defaultTab?: string;
  className?: string;
  /** Whether to render the Agent page search box. Defaults to true. */
  enableSearch?: boolean;
  searchPlaceholder?: string;
  hiddenTabs?: string[];
  value?: string;
  onValueChange?: (tabId: string) => void;
}

export function AgentTabsPage({
  appName,
  extraTabs = [],
  defaultTab = "context",
  className,
  enableSearch = true,
  searchPlaceholder = "Search agent settings",
  hiddenTabs = [],
  value,
  onValueChange,
}: AgentTabsPageProps) {
  const { data: org, isLoading: orgLoading } = useOrg();
  const hasOrg = Boolean(org?.orgId);
  const canManageOrg =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const [scope, setScope] = useState<AgentPageScope>(initialScope);
  const scopeInitialized = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const normalizedHiddenTabs = useMemo(
    () => new Set(hiddenTabs.map((tab) => normalizeTabId(tab)).filter(Boolean)),
    [hiddenTabs],
  );

  const tabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "context",
        label: "Context",
        icon: IconBrain,
        keywords: "influence provenance prompt",
        content: (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Context</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                See what can influence this agent and why.
              </p>
            </div>
            <div className="min-h-[220px] rounded-lg border border-dashed border-border/70 bg-muted/10 p-4">
              <Suspense fallback={<TabLoading />}>
                <AgentContextTab scope={scope} canManageOrg={canManageOrg} />
              </Suspense>
            </div>
          </div>
        ),
      },
      {
        id: "files",
        label: "Files",
        icon: IconFolder,
        keywords: "workspace resources instructions skills",
        content: (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Files</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Workspace files that shape the agent&apos;s context.
              </p>
            </div>
            <Suspense fallback={<TabLoading />}>
              <FilesTab scope={scope} canManageOrg={canManageOrg} />
            </Suspense>
          </div>
        ),
      },
      {
        id: "connections",
        label: "Connections",
        icon: IconPlugConnected,
        keywords: "mcp servers tools remote agents a2a",
        searchEntries: [
          { id: "mcp-servers", label: "MCP servers", keywords: "tools" },
          { id: "remote-agents", label: "Remote agents", keywords: "a2a" },
        ],
        content: <ConnectionsTab scope={scope} canManageOrg={canManageOrg} />,
      },
      {
        id: "jobs",
        label: "Jobs",
        icon: IconClock,
        keywords: "scheduled automations recurring",
        content: (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Jobs</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Scheduled work that can run with this agent.
              </p>
            </div>
            <div className="min-h-[220px] rounded-lg border border-dashed border-border/70 bg-muted/10 p-4">
              <Suspense fallback={<TabLoading />}>
                <AgentJobsTab scope={scope} canManageOrg={canManageOrg} />
              </Suspense>
            </div>
          </div>
        ),
      },
      {
        id: "access",
        label: "Access",
        icon: IconShieldLock,
        keywords: "external clients oauth a2a exposure",
        searchEntries: [
          {
            id: "mcp-connect",
            label: "External client setup",
            keywords: "oauth connect",
          },
          {
            id: "a2a-agent-card",
            label: "A2A agent card",
            keywords: "agent card",
          },
        ],
        content: (
          <AccessTab
            scope={scope}
            canManageOrg={canManageOrg}
            appName={appName}
          />
        ),
      },
      ...extraTabs,
    ],
    [canManageOrg, extraTabs, scope],
  );
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !normalizedHiddenTabs.has(tab.id)),
    [normalizedHiddenTabs, tabs],
  );
  const fallbackTab = visibleTabs.some((tab) => tab.id === defaultTab)
    ? defaultTab
    : (visibleTabs[0]?.id ?? "context");
  const [internalTab, setInternalTab] = useState(() => {
    if (typeof window === "undefined") return fallbackTab;
    return resolveTabId(visibleTabs, window.location.hash) ?? fallbackTab;
  });
  const isControlled = value !== undefined;
  const activeTab = isControlled ? value : internalTab;
  const selectedTab =
    visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];
  const tabGroups = useMemo(() => {
    const groups: Array<{ id: string; tabs: SettingsTabItem[] }> = [];
    for (const tab of visibleTabs) {
      const groupId = tab.group ?? "agent";
      const previous = groups.at(-1);
      if (previous?.id === groupId) previous.tabs.push(tab);
      else groups.push({ id: groupId, tabs: [tab] });
    }
    return groups;
  }, [visibleTabs]);

  useEffect(() => {
    if (scopeInitialized.current || orgLoading) return;
    scopeInitialized.current = true;
    if (!hasOrg && scope === "org") setScope("user");
  }, [hasOrg, orgLoading, scope]);

  useEffect(() => {
    if (orgLoading) return;
    const resolvedScope = hasOrg ? scope : "user";
    if (resolvedScope !== scope) {
      setScope(resolvedScope);
      return;
    }
    updateScopeUrl(resolvedScope);
  }, [hasOrg, orgLoading, scope]);

  useEffect(() => {
    if (!isControlled && !visibleTabs.some((tab) => tab.id === internalTab)) {
      setInternalTab(fallbackTab);
    }
  }, [fallbackTab, internalTab, isControlled, visibleTabs]);

  useEffect(() => {
    if (isControlled) return;
    const onHashChange = () => {
      const next = resolveTabId(visibleTabs, window.location.hash);
      if (next) setInternalTab(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [isControlled, visibleTabs]);

  const changeTab = useCallback(
    (tabId: string) => {
      if (!isControlled) setInternalTab(tabId);
      onValueChange?.(tabId);
    },
    [isControlled, onValueChange],
  );

  const changeScope = (next: AgentPageScope) => {
    if (next === "org" && !hasOrg) return;
    setScope(next);
    try {
      localStorage.setItem("agent-page-scope", next);
    } catch {}
    updateScopeUrl(next);
  };

  const searchIndex = useMemo(() => {
    const entries: Array<
      SettingsSearchEntry & { tabId: string; haystack: string }
    > = [];
    for (const tab of visibleTabs) {
      entries.push({
        id: `tab:${tab.id}`,
        label: tab.label,
        keywords: tab.keywords,
        tabId: tab.id,
        haystack: `${tab.label} ${tab.keywords ?? ""}`.toLowerCase(),
      });
      for (const entry of tab.searchEntries ?? []) {
        entries.push({
          ...entry,
          tabId: entry.tabId ?? tab.id,
          haystack:
            `${entry.label} ${entry.keywords ?? ""} ${entry.description ?? ""} ${tab.label}`.toLowerCase(),
        });
      }
    }
    return entries;
  }, [visibleTabs]);
  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return searchIndex
      .filter((entry) => terms.every((term) => entry.haystack.includes(term)))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [query, searchIndex]);

  const selectSearchResult = useCallback(
    (entry: (typeof searchIndex)[number]) => {
      changeTab(entry.tabId);
      setQuery("");
      if (isControlled || typeof window === "undefined") return;
      if (entry.hash) {
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${window.location.search}#${entry.hash.replace(/^#/, "")}`,
        );
        window.dispatchEvent(new Event("hashchange"));
      } else {
        updateTabHash(entry.tabId);
      }
    },
    [changeTab, isControlled],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-foreground">Agent</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What can influence this agent, and why.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Scope</span>
          <div
            className="flex rounded-md border border-border bg-muted/30 p-0.5"
            role="radiogroup"
            aria-label="Agent scope"
          >
            <button
              type="button"
              role="radio"
              aria-checked={scope !== "org" || !hasOrg}
              onClick={() => changeScope("user")}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium",
                scope !== "org" || !hasOrg
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Personal
            </button>
            {hasOrg && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={scope === "org"}
                    onClick={() => changeScope("org")}
                    className={cn(
                      "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium",
                      scope === "org"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Organization
                  </button>
                </TooltipTrigger>
                {!canManageOrg && (
                  <TooltipContent>
                    Organization settings are read-only for members.
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="flex shrink-0 flex-col gap-2 bg-background p-2 sm:min-h-0 sm:w-56 sm:overflow-y-auto sm:p-3">
          {enableSearch ? (
            <div className="relative sm:mb-1">
              <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                  if (event.key === "Enter" && results[0]) {
                    event.preventDefault();
                    selectSearchResult(results[0]);
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute end-1.5 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <IconX className="size-3.5" />
                </button>
              )}
            </div>
          ) : null}
          {query.trim() ? (
            <div
              role="listbox"
              aria-label="Agent search results"
              className="flex flex-col gap-0.5"
            >
              {results.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No matching agent settings
                </p>
              ) : (
                results.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    onClick={() => selectSearchResult(entry)}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground hover:bg-accent/60"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {entry.label}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {entry.description ?? entry.tabId}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <nav
              aria-label="Agent sections"
              role="tablist"
              className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible"
            >
              {tabGroups.map((group, groupIndex) => (
                <div
                  key={group.id}
                  className={cn(
                    "contents sm:block",
                    groupIndex > 0 &&
                      "sm:mt-2 sm:border-t sm:border-border/60 sm:pt-2",
                  )}
                >
                  <div className="contents sm:flex sm:flex-col sm:gap-1">
                    {group.tabs.map((tab) => {
                      const Icon = tab.icon as SettingsTabIcon | undefined;
                      const selected = tab.id === selectedTab?.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls={`agent-tabpanel-${tab.id}`}
                          onClick={() => {
                            changeTab(tab.id);
                            if (!isControlled) updateTabHash(tab.id);
                          }}
                          className={cn(
                            "flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors sm:w-full",
                            selected
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          )}
                        >
                          {Icon ? (
                            <Icon
                              className={cn(
                                "size-4 shrink-0",
                                selected
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            />
                          ) : null}
                          <span className="truncate">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          )}
        </div>
        <div
          id={`agent-tabpanel-${selectedTab?.id ?? "context"}`}
          role="tabpanel"
          aria-labelledby={`agent-tab-${selectedTab?.id ?? "context"}`}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6"
        >
          {selectedTab?.content ?? <EmptySlot label="Agent section" />}
        </div>
      </div>
    </div>
  );
}
