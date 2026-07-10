import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { dispatchActions } from "@agent-native/dispatch/actions";
import { z } from "zod";

import { listDispatchUsageMetricsScoped } from "../server/lib/usage-metrics.js";
import listWorkspaceConnections from "./list-workspace-connections.js";

async function runDispatchAction(name: string, args: Record<string, unknown>) {
  const action = dispatchActions[name];
  if (!action) throw new Error(`Dispatch action not found: ${name}`);
  return action.run(stripUndefined(args) as any);
}

function stripUndefined(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
}

function optionalTimestamp(source: object, key: string) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export default defineAction({
  description:
    "See what the user is currently looking at in the dispatch UI, including navigation state and a compact operational summary.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const [navigation, overview] = await Promise.all([
      readAppState("navigation"),
      runDispatchAction("list-dispatch-overview", {}),
    ]);

    const screen: Record<string, unknown> = {
      counts: { ...(overview.counts ?? {}), ...(overview.vault ?? {}) },
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
      screen.recentAudit = overview.recentAudit?.slice(0, 5) ?? [];
      screen.recentApprovals = overview.recentApprovals?.slice(0, 5) ?? [];
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations ?? [];
    }
    if (navigation?.view === "agents") {
      const [connectedAgents, mcpAccess] = await Promise.all([
        runDispatchAction("list-connected-agents", {}),
        runDispatchAction("list-mcp-app-access", {}),
      ]);
      screen.connectedAgents = connectedAgents;
      screen.mcpAppAccess = mcpAccess;
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
      screen.workspaceApps = await runDispatchAction("list-workspace-apps", {
        includeAgentCards: true,
      });
    }
    if (navigation?.view === "metrics") {
      try {
        const metrics = await listDispatchUsageMetricsScoped({ sinceDays: 30 });
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
      const [secrets, grants, requests] = await Promise.all([
        runDispatchAction("list-vault-secrets", {}),
        runDispatchAction("list-vault-grants", {}),
        runDispatchAction("list-vault-requests", { status: "pending" }),
      ]);
      screen.vaultSecrets = Array.isArray(secrets)
        ? secrets.map((secret) => ({
            id: secret.id,
            name: secret.name,
            credentialKey: secret.credentialKey,
            provider: secret.provider,
          }))
        : [];
      screen.vaultActiveGrants = Array.isArray(grants)
        ? grants
            .filter((grant) => grant.status === "active")
            .map((grant) => ({
              secretId: grant.secretId,
              appId: grant.appId,
            }))
        : [];
      screen.vaultPendingRequests = requests;
    }
    if (navigation?.view === "integrations") {
      try {
        const integrations = await listWorkspaceConnections.run({
          includeDisabled: true,
        });
        screen.workspaceIntegrations = {
          providers: integrations.providers.map((provider) => ({
            id: provider.id,
            label: provider.label,
            capabilities: provider.capabilities,
            recommendedTemplateUses: provider.recommendedTemplateUses,
            readiness: provider.readiness,
          })),
          connections: integrations.connections.map((connection) => {
            const lastUsedAt = optionalTimestamp(connection, "lastUsedAt");
            return {
              id: connection.id,
              provider: connection.provider,
              label: connection.label,
              accountLabel: connection.accountLabel,
              status: connection.status,
              scopes: connection.scopes,
              allowedApps:
                connection.allowedApps.length === 0
                  ? "all-apps"
                  : connection.allowedApps,
              credentialRefs: connection.credentialRefs.map((ref) => ({
                key: ref.key,
                label: ref.label,
                provider: ref.provider,
                scope: ref.scope,
              })),
              lastCheckedAt: connection.lastCheckedAt,
              ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
              lastError: connection.lastError,
            };
          }),
          grants: integrations.grants,
          grantSummaries: integrations.grantSummaries,
          suggestedApps: integrations.suggestedApps,
          counts: integrations.counts,
        };
      } catch (error) {
        screen.workspaceIntegrationsError =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (navigation?.view === "workspace" || navigation?.view === "new-app") {
      screen.workspaceResources = await runDispatchAction(
        "list-workspace-resource-options",
        {},
      );
    }
    if (navigation?.view === "thread-debug") {
      try {
        const nav = navigation as Record<string, any>;
        screen.threadDebugSources = await runDispatchAction(
          "list-agent-thread-sources",
          {},
        );
        if (nav.query) {
          screen.threadDebugResults = await runDispatchAction(
            "search-agent-threads",
            {
              sourceId: nav.sourceId,
              query: nav.query,
              ownerEmail: nav.ownerEmail,
              limit: 10,
            },
          );
        }
        if (nav.threadId) {
          const detail = (await runDispatchAction("get-agent-thread-debug", {
            sourceId: nav.sourceId,
            threadId: nav.threadId,
            ownerEmail: nav.ownerEmail,
            maxRuns: 5,
            maxEvents: 80,
            maxTraceSpans: 50,
          })) as any;
          screen.threadDebugSelection = {
            source: detail.source,
            thread: detail.thread,
            messageCount: detail.messages?.length ?? 0,
            runCount: detail.runs?.length ?? 0,
            debug: detail.debug,
            debugRuns: detail.debugRuns?.slice(-5) ?? [],
            messages: detail.messages?.slice(-6) ?? [],
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
          runDispatchAction("list-agent-thread-sources", {}),
          runDispatchAction("list-dream-candidates", {
            sourceId: nav.sourceId,
            ownerEmail: nav.ownerEmail,
            limit: 10,
          }),
          runDispatchAction("list-dreams", {
            status: nav.status,
            limit: 10,
          }),
          runDispatchAction("get-dream-settings", {}),
        ]);
        screen.dreamSources = sources;
        screen.dreamCandidates = candidates;
        screen.latestDreams = dreams;
        screen.dreamSettings = settings;

        const dreamId = nav.dreamId ?? nav.id;
        if (dreamId) {
          screen.dreamDetail = await runDispatchAction("get-dream", {
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
