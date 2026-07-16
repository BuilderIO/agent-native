import {
  IconBook2,
  IconChecklist,
  IconClock,
  IconExternalLink,
  IconFolder,
  IconHistory,
  IconHierarchy2,
  IconNotes,
  IconPlugConnected,
  IconTopologyRing2,
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
  type ReactNode,
} from "react";

import {
  MCP_CONNECT_GUIDES,
  MCP_CONNECT_MCP_URL_TEMPLATE,
  MCP_STATIC_TOKEN_FALLBACK,
  interpolateMcpConnectTemplate,
  type McpConnectTemplateValues,
} from "../../shared/mcp-connect-content.js";
import { appPath } from "../api-path.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import {
  McpIntegrationDialog,
  // The dialog is intentionally reused here so the Agent page remains a thin
  // host for the existing MCP management flow.
} from "../resources/McpIntegrationDialog.js";
import { McpServerDetail } from "../resources/McpServerDetail.js";
import type { ResourceView } from "../resources/ResourcesPanel.js";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  type McpServer,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";
import type {
  SettingsSearchEntry,
  SettingsTabItem,
} from "../settings/SettingsTabsPage.js";
import { cn } from "../utils.js";
import { AgentEmptyState } from "./AgentEmptyState.js";
import { AgentTabFrame } from "./AgentTabFrame.js";
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
  if (normalized === "context" && tabs.some((tab) => tab.id === "snapshots")) {
    return "snapshots";
  }
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
  const hash = tabId === "files" ? "" : `#${encodeURIComponent(tabId)}`;
  window.history.pushState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
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

const RESOURCE_TAB_COPY: Record<
  ResourceView,
  { title: string; description: string }
> = {
  files: {
    title: "Files",
    description: "Plain workspace files the agent can read and write.",
  },
  instructions: {
    title: "Instructions",
    description:
      "The rules, preferences, and project guidance that steer the agent.",
  },
  agents: {
    title: "Agents",
    description: "Reusable profiles for focused sub-agents and delegated work.",
  },
  memory: {
    title: "Memory",
    description: "Durable notes the agent can retrieve across conversations.",
  },
  skills: {
    title: "Skills",
    description:
      "Specialized instructions that give the agent repeatable abilities.",
  },
  learnings: {
    title: "Learnings",
    description:
      "Corrections and patterns worth carrying forward for future work.",
  },
  "remote-agents": {
    title: "Remote agents",
    description: "Other agents this workspace can call through A2A.",
  },
};

function AgentResourceTab({
  scope,
  view,
}: AgentPageTabProps & { view: ResourceView }) {
  const copy = RESOURCE_TAB_COPY[view];
  return (
    <AgentTabFrame title={copy.title} description={copy.description}>
      <div className="min-h-[480px]">
        <ResourcesPanel
          key={`${scope}-${view}`}
          showMcpServers={false}
          resourceFilter={view}
          resourceTreeVariant={view === "files" ? "tree" : "collection"}
          scope="personal"
        />
      </div>
    </AgentTabFrame>
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

function ConnectionsTab({ canManageOrg = false }: AgentPageTabProps) {
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
          "group/connection-row py-4 transition-colors first:pt-5 last:pb-5",
          selected && "bg-accent/20",
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
    <AgentTabFrame
      title="Connections"
      description="Tools and services this agent can reach, grouped by where they are configured."
      actions={
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
      }
    >
      <section className="space-y-4">
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
        ) : (
          <div className="space-y-6">
            {[
              { label: "Personal", servers: data?.user ?? [] },
              { label: "Organization", servers: data?.org ?? [] },
            ].map((section) => (
              <section key={section.label} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {section.label}
                </h2>
                {section.servers.length > 0 ? (
                  <div className="divide-y divide-border/60 border-y border-border/60">
                    {section.servers.map(renderServer)}
                  </div>
                ) : (
                  <AgentEmptyState
                    icon={IconPlugConnected}
                    title={`No ${section.label.toLowerCase()} connections yet`}
                    description={
                      section.label === "Personal"
                        ? "Connect a service to give the agent access to it."
                        : "Organization connections shared with this workspace will appear here."
                    }
                  />
                )}
              </section>
            ))}
          </div>
        )}
        <McpIntegrationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          defaultScope="user"
          canCreateOrgMcp={canCreateOrgMcp}
          hasOrg={hasOrg}
          onCreateMcpServer={onCreateMcpServer}
        />
      </section>
    </AgentTabFrame>
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
    <AgentTabFrame
      title="Access"
      description="Choose which external clients can talk to this app's agent."
    >
      <div className="space-y-6">
        {urls ? (
          <>
            <CopyField label="MCP URL" value={urls.mcpUrl} />
            {agentCardAvailable && (
              <CopyField label="A2A agent card" value={urls.agentCardUrl} />
            )}
            <section className="space-y-3 border-t border-border/70 pt-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Client setup
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  These instructions are also available on the full connect
                  page.
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
                      {interpolateMcpConnectTemplate(
                        guide.intro,
                        templateValues,
                      )}
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
                      {interpolateMcpConnectTemplate(
                        guide.note,
                        templateValues,
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
            <section className="border-t border-border/70 pt-6">
              <h3 className="text-sm font-semibold text-foreground">
                {MCP_STATIC_TOKEN_FALLBACK.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {MCP_STATIC_TOKEN_FALLBACK.state}. Open the connect page to
                create a token for clients that cannot complete OAuth.
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
    </AgentTabFrame>
  );
}

export interface AgentPageExtraTabContext extends AgentPageTabProps {
  scopeControl: ReactNode;
}

export type AgentPageExtraTabFactory = (
  context: AgentPageExtraTabContext,
) => SettingsTabItem;

export interface AgentTabsPageProps {
  /**
   * Human-readable app name used in the Access tab's connect instructions
   * (e.g. "name it Mail"). Falls back to the `og:site_name` meta tag, then a
   * hostname-derived guess — never `document.title`, which this page owns.
   */
  appName?: string;
  extraTabs?: SettingsTabItem[];
  /** Scoped app-specific tabs that receive the current Agent workspace scope. */
  extraTabFactories?: AgentPageExtraTabFactory[];
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
  extraTabFactories = [],
  defaultTab = "files",
  className,
  enableSearch = true,
  searchPlaceholder = "Search agent workspace",
  hiddenTabs = [],
  value,
  onValueChange,
}: AgentTabsPageProps) {
  const { data: org } = useOrg();
  const canManageOrg =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const scope: AgentPageScope = "user";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const normalizedHiddenTabs = useMemo(
    () => new Set(hiddenTabs.map((tab) => normalizeTabId(tab)).filter(Boolean)),
    [hiddenTabs],
  );
  const scopeControl: ReactNode = null;
  const scopedExtraTabs = useMemo(
    () =>
      extraTabFactories.map((factory) =>
        factory({ scope, canManageOrg, scopeControl }),
      ),
    [canManageOrg, extraTabFactories, scope, scopeControl],
  );

  const tabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "files",
        label: "Files",
        icon: IconFolder,
        group: "resources",
        keywords: "workspace plain files documents uploads",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="files" />
          </Suspense>
        ),
      },
      {
        id: "instructions",
        label: "Instructions",
        icon: IconChecklist,
        group: "resources",
        keywords: "agents md rules preferences guidance",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="instructions" />
          </Suspense>
        ),
      },
      {
        id: "agents",
        label: "Agents",
        icon: IconHierarchy2,
        group: "resources",
        keywords: "custom sub agents delegate profiles",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="agents" />
          </Suspense>
        ),
      },
      {
        id: "memory",
        label: "Memory",
        icon: IconNotes,
        group: "resources",
        keywords: "long term notes memory index recall",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="memory" />
          </Suspense>
        ),
      },
      {
        id: "skills",
        label: "Skills",
        icon: IconBook2,
        group: "resources",
        keywords: "abilities reusable instructions workflows",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="skills" />
          </Suspense>
        ),
      },
      {
        id: "learnings",
        label: "Learnings",
        icon: IconHistory,
        group: "resources",
        keywords: "corrections patterns knowledge feedback",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="learnings" />
          </Suspense>
        ),
      },
      {
        id: "remote-agents",
        label: "Remote agents",
        icon: IconTopologyRing2,
        group: "resources",
        keywords: "a2a connected remote agents delegation",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentResourceTab scope={scope} view="remote-agents" />
          </Suspense>
        ),
      },
      {
        id: "snapshots",
        label: "Snapshots",
        icon: IconHistory,
        group: "agent",
        keywords: "context recent loads provenance tokens",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentContextTab scope={scope} canManageOrg={canManageOrg} />
          </Suspense>
        ),
      },
      {
        id: "connections",
        label: "Connections",
        icon: IconPlugConnected,
        group: "agent",
        keywords: "mcp servers tools integrations",
        searchEntries: [
          { id: "mcp-servers", label: "MCP servers", keywords: "tools" },
        ],
        content: <ConnectionsTab scope={scope} canManageOrg={canManageOrg} />,
      },
      {
        id: "jobs",
        label: "Jobs",
        icon: IconClock,
        group: "agent",
        keywords: "scheduled automations recurring",
        content: (
          <Suspense fallback={<TabLoading />}>
            <AgentJobsTab scope={scope} canManageOrg={canManageOrg} />
          </Suspense>
        ),
      },
      {
        id: "access",
        label: "Access",
        icon: IconShieldLock,
        group: "agent",
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
      ...scopedExtraTabs,
    ],
    [appName, canManageOrg, extraTabs, scope, scopedExtraTabs],
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
                  No matching agent workspace items
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
                  {group.id === "resources" && (
                    <div className="hidden px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50 sm:block">
                      Agent resources
                    </div>
                  )}
                  {group.id === "agent" && (
                    <div className="hidden px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50 sm:block">
                      Agent operations
                    </div>
                  )}
                  <div className="contents sm:flex sm:flex-col sm:gap-1">
                    {group.tabs.map((tab) => {
                      const Icon = tab.icon as SettingsTabIcon | undefined;
                      const selected = tab.id === selectedTab?.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          id={`agent-tab-${tab.id}`}
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
