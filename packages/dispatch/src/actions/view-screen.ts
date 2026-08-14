/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { listWorkspaceApps } from "../server/lib/app-creation-store.js";
import { listOverview } from "../server/lib/dispatch-store.js";
import {
  getAgentThreadDebug,
  listAgentRunFailures,
  listThreadDebugSources,
  searchAgentThreads,
} from "../server/lib/thread-debug-store.js";
import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";
import {
  listVaultOverview,
  listSecretOptions,
  listGrants,
  listRequests,
  getVaultAccessSettings,
  canManageVault,
} from "../server/lib/vault-store.js";
import {
  listWorkspaceResourceOptions,
  listWorkspaceResourcesForApp,
} from "../server/lib/workspace-resources-store.js";

async function runLocalDispatchAction(
  name: string,
  args: Record<string, unknown>,
) {
  const modulePath = `./${name}.js`;
  const module = (await import(/* @vite-ignore */ modulePath)) as {
    default?: {
      run: (args: Record<string, unknown>) => unknown | Promise<unknown>;
    };
  };
  if (!module.default) throw new Error(`Dispatch action not found: ${name}`);
  return module.default.run(stripUndefined(args));
}

function stripUndefined(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
}

function threadDebugLookbackHours(value: unknown): number {
  if (value === "7d") return 168;
  if (value === "30d") return 720;
  return 24;
}

function threadDebugFailureStatus(
  value: unknown,
): "all" | "errored" | "aborted" | "truncated" {
  return value === "errored" || value === "aborted" || value === "truncated"
    ? value
    : "all";
}

export default defineAction({
  description:
    "See what the user is currently looking at in the dispatch UI, including navigation state and a compact operational summary.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const [navigation, overview, vaultOverview] = await Promise.all([
      readAppState("navigation"),
      listOverview(),
      listVaultOverview(),
    ]);

    const screen: Record<string, unknown> = {
      counts: { ...overview.counts, ...vaultOverview },
      approvalPolicy: overview.settings,
    };
    if (navigation) screen.navigation = navigation;
    if (navigation?.view === "chat" || navigation?.view === "browser-chat") {
      screen.chatSurface = {
        view:
          navigation.view === "browser-chat"
            ? "embedded browser chat"
            : "full-page Dispatch chat",
        purpose:
          "Create apps, manage workspace resources, route work to connected agents, and continue Dispatch conversations.",
      };
      const agentPath =
        typeof navigation.agentPath === "string"
          ? navigation.agentPath.trim()
          : "";
      if (agentPath) {
        const agents = await listWorkspaceResourceOptions({ kind: "agent" });
        const agent = agents.find((resource) => resource.path === agentPath);
        screen.chatSurface = {
          ...(screen.chatSurface as Record<string, unknown>),
          agentPath,
          ...(agent ? { agent } : {}),
        };
      }
    }
    if (navigation?.view === "overview") {
      screen.recentAudit = overview.recentAudit.slice(0, 5);
      screen.recentApprovals = overview.recentApprovals.slice(0, 5);
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations;
    }
    if (navigation?.view === "connected-agents") {
      const [connectedAgents, mcpAccess] = await Promise.all([
        runLocalDispatchAction("list-connected-agents", {}),
        runLocalDispatchAction("list-mcp-app-access", {}),
      ]);
      screen.connectedAgents = connectedAgents;
      screen.mcpAppAccess = mcpAccess;
    }
    if (navigation?.view === "agents") {
      screen.simpleAgents = await listWorkspaceResourceOptions({
        kind: "agent",
      });
    }
    if (navigation?.view === "operations") {
      const nav = navigation as { operationsView?: string };
      screen.operatorConsole = {
        view: nav.operationsView === "database" ? "database" : "monitoring",
        monitoring:
          "The shared observability dashboard provides traces, conversations, evaluations, experiments, and feedback.",
        database:
          "The shared database admin is available in Code mode for table browsing and SQL inspection.",
        relatedTools: ["thread-debug", "audit", "destinations", "automations"],
      };
    }
    if (
      navigation?.view === "overview" ||
      navigation?.view === "metrics" ||
      navigation?.view === "apps" ||
      navigation?.view === "new-app"
    ) {
      const workspaceApps = await listWorkspaceApps({
        includeAgentCards: true,
      });
      screen.workspaceApps = workspaceApps;
      if (navigation?.view === "apps") {
        screen.workspaceAppResources = await Promise.all(
          workspaceApps
            .filter((app) => !app.isDispatch)
            .slice(0, 12)
            .map(async (app) => {
              const result = await listWorkspaceResourcesForApp(app.id);
              return {
                appId: app.id,
                appName: app.name,
                counts: result.counts,
                resources: result.resources.map((resource) => ({
                  name: resource.name,
                  path: resource.path,
                  kind: resource.kind,
                  source: resource.source,
                  autoLoaded: resource.autoLoaded,
                })),
              };
            }),
        );
      }
    }
    if (navigation?.view === "metrics") {
      try {
        const usageScope =
          navigation.usageScope === "workspace" ? "workspace" : "me";
        const usageUserEmail =
          typeof navigation.usageUserEmail === "string"
            ? navigation.usageUserEmail
            : undefined;
        const metrics = await listDispatchUsageMetrics({
          sinceDays: 30,
          scope: usageScope,
          userEmail: usageUserEmail,
        });
        screen.usageMetrics = {
          billing: metrics.billing,
          viewScope: metrics.viewScope,
          selectedUserEmail: metrics.selectedUserEmail,
          totals: metrics.totals,
          byApp: metrics.byApp.slice(0, 8),
          byUser: metrics.byUser.slice(0, 8),
          appAccess: metrics.appAccess
            .filter((app) => !app.isDispatch)
            .slice(0, 8),
        };
      } catch (error) {
        screen.usageMetricsError =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (navigation?.view === "vault" || navigation?.view === "new-app") {
      const isVaultAdmin = await canManageVault();
      const [secrets, grants, requests, access] = await Promise.all([
        listSecretOptions(),
        isVaultAdmin ? listGrants() : Promise.resolve([]),
        listRequests({ status: "pending" }),
        getVaultAccessSettings(),
      ]);
      screen.vaultAccessMode = access.mode;
      screen.vaultSecrets = secrets.map((s) => ({
        id: s.id,
        name: s.name,
        credentialKey: s.credentialKey,
        provider: s.provider,
      }));
      screen.vaultActiveGrants = grants
        .filter((g) => g.status === "active")
        .map((g) => ({ secretId: g.secretId, appId: g.appId }));
      screen.vaultPendingRequests = requests;
    }
    if (navigation?.view === "workspace" || navigation?.view === "new-app") {
      screen.workspaceResources = await listWorkspaceResourceOptions();
      screen.workspaceResourceEffectiveContext = {
        action: "get-workspace-resource-effective-context",
        description:
          "Preview workspace -> organization/app -> personal precedence for a resource path and optional app/user. All-app resources are inherited at runtime; selected resources are app-specific exceptions.",
      };
      screen.workspaceResourceImpactPreview = {
        action: "preview-workspace-resource-change",
        description:
          "Preview All-app reach, overrides, and approval behavior before creating, updating, or deleting a workspace resource.",
      };
    }
    if (navigation?.view === "thread-debug") {
      try {
        const nav = navigation as Record<string, any>;
        screen.threadDebugSources = await listThreadDebugSources();
        if (nav.threadDebugMode !== "threads") {
          screen.agentRunFailures = await listAgentRunFailures({
            sourceId: nav.sourceId ?? "all",
            ownerEmail: nav.ownerEmail,
            status: threadDebugFailureStatus(nav.failureStatus),
            lookbackHours: threadDebugLookbackHours(nav.range),
            limit: 10,
          });
        } else if (nav.query) {
          screen.threadDebugResults = await searchAgentThreads({
            sourceId: nav.sourceId,
            query: nav.query,
            ownerEmail: nav.ownerEmail,
            limit: 10,
          });
        }
        if (nav.threadId || nav.runId) {
          const detail = await getAgentThreadDebug({
            sourceId:
              nav.runId && nav.inspectSourceId
                ? nav.inspectSourceId
                : nav.sourceId,
            threadId: nav.runId ? undefined : nav.threadId,
            runId: nav.runId,
            ownerEmail: nav.ownerEmail,
            maxRuns: 5,
            maxEvents: 80,
            maxTraceSpans: 50,
          });
          screen.threadDebugSelection = {
            source: detail.source,
            thread: detail.thread,
            messageCount: detail.messages.length,
            runCount: detail.runs.length,
            debug: detail.debug,
            debugRuns: (detail as any).debugRuns?.slice(-5) ?? [],
            messages: detail.messages.slice(-6),
            runs: detail.runs
              .slice(0, 5)
              .map(({ events: _events, ...run }) => run),
          };
        }
      } catch (error) {
        screen.threadDebugError =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (navigation?.view === "dreams") {
      try {
        const nav = navigation as Record<string, any>;
        const [sources, candidates, dreams, settings] = await Promise.all([
          listThreadDebugSources(),
          runLocalDispatchAction("list-dream-candidates", {
            sourceId: nav.sourceId,
            ownerEmail: nav.ownerEmail,
            limit: 10,
          }),
          runLocalDispatchAction("list-dreams", {
            status: nav.status,
            limit: 10,
          }),
          runLocalDispatchAction("get-dream-settings", {}),
        ]);
        screen.dreamSources = sources;
        screen.dreamCandidates = candidates;
        screen.latestDreams = dreams;
        screen.dreamSettings = settings;

        const dreamId = nav.dreamId ?? nav.id;
        if (dreamId) {
          screen.dreamDetail = await runLocalDispatchAction("get-dream", {
            id: dreamId,
          });
        }
      } catch (error) {
        screen.dreamsError =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
