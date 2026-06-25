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
  listThreadDebugSources,
  searchAgentThreads,
} from "../server/lib/thread-debug-store.js";
import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";
import {
  listVaultOverview,
  listSecrets,
  listGrants,
  listRequests,
  getVaultAccessSettings,
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
    if (navigation?.view === "chat") {
      screen.chatSurface = {
        view: "full-page Dispatch chat",
        purpose:
          "Create apps, manage workspace resources, route work to connected agents, and continue Dispatch conversations.",
      };
    }
    if (navigation?.view === "overview") {
      screen.recentAudit = overview.recentAudit.slice(0, 5);
      screen.recentApprovals = overview.recentApprovals.slice(0, 5);
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations;
    }
    if (navigation?.view === "agents") {
      const [connectedAgents, mcpAccess] = await Promise.all([
        runLocalDispatchAction("list-connected-agents", {}),
        runLocalDispatchAction("list-mcp-app-access", {}),
      ]);
      screen.connectedAgents = connectedAgents;
      screen.mcpAppAccess = mcpAccess;
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
        const metrics = await listDispatchUsageMetrics({ sinceDays: 30 });
        screen.usageMetrics = {
          billing: metrics.billing,
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
      const [secrets, grants, requests, access] = await Promise.all([
        listSecrets(),
        listGrants(),
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
        if (nav.query) {
          screen.threadDebugResults = await searchAgentThreads({
            sourceId: nav.sourceId,
            query: nav.query,
            ownerEmail: nav.ownerEmail,
            limit: 10,
          });
        }
        if (nav.threadId) {
          const detail = await getAgentThreadDebug({
            sourceId: nav.sourceId,
            threadId: nav.threadId,
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
