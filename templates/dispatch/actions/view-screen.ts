import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { dispatchActions } from "@agent-native/dispatch/actions";
import { z } from "zod";
import { listDispatchUsageMetricsScoped } from "../server/lib/usage-metrics.js";

async function runDispatchAction(name: string, args: Record<string, unknown>) {
  const action = dispatchActions[name];
  if (!action) throw new Error(`Dispatch action not found: ${name}`);
  return action.run(args as any);
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
    if (navigation?.view === "overview") {
      screen.recentAudit = overview.recentAudit?.slice(0, 5) ?? [];
      screen.recentApprovals = overview.recentApprovals?.slice(0, 5) ?? [];
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations ?? [];
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

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
