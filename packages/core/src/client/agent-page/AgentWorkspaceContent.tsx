import {
  IconBook2,
  IconBolt,
  IconChecklist,
  IconFolder,
  IconHierarchy2,
  IconHistory,
  IconNotes,
  IconShieldLock,
  IconTopologyRing2,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import type { ResourceView } from "../resources/ResourcesPanel.js";
import { AgentsSection } from "../settings/AgentsSection.js";
import { cn } from "../utils.js";
import { AgentJobsTab } from "./AgentJobsTab.js";

const ResourcesPanel = lazy(() =>
  import("../resources/ResourcesPanel.js").then((module) => ({
    default: module.ResourcesPanel,
  })),
);

export type AgentWorkspaceTab =
  | "overview"
  | "resources"
  | "automations"
  | "agents"
  | "access";

const RESOURCE_TABS: Array<{
  id: ResourceView;
  label: string;
  icon: typeof IconFolder;
}> = [
  { id: "files", label: "Files", icon: IconFolder },
  { id: "instructions", label: "Instructions", icon: IconChecklist },
  { id: "agents", label: "Agents", icon: IconHierarchy2 },
  { id: "memory", label: "Memory", icon: IconNotes },
  { id: "skills", label: "Skills", icon: IconBook2 },
  { id: "learnings", label: "Learnings", icon: IconHistory },
  { id: "remote-agents", label: "Remote agents", icon: IconTopologyRing2 },
];

const HUB_TABS: Array<{
  id: AgentWorkspaceTab;
  label: string;
  icon: typeof IconFolder;
}> = [
  { id: "overview", label: "Overview", icon: IconHierarchy2 },
  { id: "resources", label: "Resources", icon: IconFolder },
  { id: "automations", label: "Automations", icon: IconBolt },
  { id: "agents", label: "Connected agents", icon: IconTopologyRing2 },
  { id: "access", label: "Access", icon: IconShieldLock },
];

const RESOURCE_IDS = new Set(RESOURCE_TABS.map((tab) => tab.id));

function normalizeHash(value: string): string {
  return decodeURIComponent(value.replace(/^#/, "")).toLowerCase();
}

function initialHubState(): {
  tab: AgentWorkspaceTab;
  resource: ResourceView;
} {
  if (typeof window === "undefined") {
    return { tab: "overview", resource: "files" };
  }
  const hash = normalizeHash(window.location.hash);
  const parts = hash.split(":");
  const scoped = parts[0] === "agent";
  const requested = scoped ? parts[1] : hash;
  const resource =
    scoped && RESOURCE_IDS.has(parts[2] as ResourceView)
      ? (parts[2] as ResourceView)
      : "files";

  if (
    requested === "resources" ||
    (!scoped && RESOURCE_IDS.has(hash as ResourceView))
  ) {
    return {
      tab: "resources",
      resource: scoped ? resource : (hash as ResourceView),
    };
  }
  if (requested === "automations" || requested === "jobs") {
    return { tab: "automations", resource };
  }
  if (
    requested === "agents" ||
    requested === "a2a" ||
    requested === "connected-agents" ||
    requested === "remote-agents"
  ) {
    return { tab: "agents", resource };
  }
  if (requested === "access") return { tab: "access", resource };
  return { tab: "overview", resource };
}

function ResourceContent({ resource }: { resource: ResourceView }) {
  const copy = RESOURCE_TABS.find((tab) => tab.id === resource);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 overflow-x-auto">
        {RESOURCE_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === resource;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.history.pushState(
                    null,
                    "",
                    `${window.location.pathname}${window.location.search}#agent:resources:${tab.id}`,
                  );
                  window.dispatchEvent(new Event("hashchange"));
                }
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {copy?.label ?? "Resources"}
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">
          {resource === "files"
            ? "Add context the agent can use across conversations."
            : "Manage the resources that shape how the agent works."}
        </p>
      </header>
      <Suspense
        fallback={
          <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/20" />
        }
      >
        <ResourcesPanel
          key={resource}
          showMcpServers={false}
          resourceFilter={resource}
          resourceTreeVariant="collection"
          scope="personal"
        />
      </Suspense>
    </div>
  );
}

function AccessContent() {
  return (
    <div>
      <div className="rounded-xl border border-border/70 bg-card text-card-foreground">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
              <IconShieldLock className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Agent access
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Use the agent card and MCP endpoints from connected clients.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentWorkspaceContent({
  overview,
  className,
  activeTab,
}: {
  overview: ReactNode;
  activeTab: AgentWorkspaceTab;
  className?: string;
}) {
  const [{ resource }, setState] = useState(initialHubState);

  useEffect(() => {
    const sync = () => setState(initialHubState());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const page = HUB_TABS.find((item) => item.id === activeTab);
  const pageDescription =
    activeTab === "overview"
      ? "Configure how your agent works, what it knows, and what it can do."
      : activeTab === "resources"
        ? "Add context the agent can use across conversations."
        : activeTab === "automations"
          ? "Schedule and manage agent tasks."
          : activeTab === "agents"
            ? "Connect agents to delegate work from chat."
            : "Control how other apps and agents access this agent.";

  return (
    <div className={cn("w-full space-y-6", className)}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {activeTab === "overview" ? "Agent" : page?.label}
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          {pageDescription}
        </p>
      </header>

      {activeTab === "overview" && overview}
      {activeTab === "resources" && <ResourceContent resource={resource} />}
      {activeTab === "automations" && (
        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/20" />
          }
        >
          <AgentJobsTab scope="user" canManageOrg hideHeader />
        </Suspense>
      )}
      {activeTab === "agents" && <AgentsSection />}
      {activeTab === "access" && <AccessContent />}
    </div>
  );
}

export function agentWorkspaceTabHash(tab: AgentWorkspaceTab): string {
  return `agent:${tab}`;
}

export function isAgentWorkspaceTab(value: string): boolean {
  return value === "agent" || value.startsWith("agent:");
}
