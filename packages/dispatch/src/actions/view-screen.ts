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
import { listOverview } from "../server/lib/dispatch-store.js";
import {
  listVaultOverview,
  listSecrets,
  listGrants,
  listRequests,
} from "../server/lib/vault-store.js";
import { listWorkspaceApps } from "../server/lib/app-creation-store.js";
import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";

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
    if (navigation?.view === "overview") {
      screen.recentAudit = overview.recentAudit.slice(0, 5);
      screen.recentApprovals = overview.recentApprovals.slice(0, 5);
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations;
    }
    if (
      navigation?.view === "overview" ||
      navigation?.view === "metrics" ||
      navigation?.view === "apps" ||
      navigation?.view === "new-app"
    ) {
      screen.workspaceApps = await listWorkspaceApps({
        includeAgentCards: true,
      });
    }
    if (navigation?.view === "metrics") {
      try {
        const metrics = await listDispatchUsageMetrics({ sinceDays: 30 });
        screen.usageMetrics = {
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
        listSecrets(),
        listGrants(),
        listRequests({ status: "pending" }),
      ]);
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

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
