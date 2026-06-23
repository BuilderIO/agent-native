import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { getAnalysis, getDashboard } from "../server/lib/dashboards-store";
import { listAnalyticsPublicKeys } from "../server/lib/first-party-analytics.js";
import { listDashboardCatalog } from "../server/lib/dashboard-catalog";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, dashboard config (if on a dashboard), analysis details (if on an analysis), and any active URL filter params. Prefer the auto-included <current-screen> block; call this only when you need a refreshed snapshot.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation");
    const url = (await readAppState("__url__")) as {
      pathname?: string;
      search?: string;
      searchParams?: Record<string, string>;
    } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (url?.pathname) screen.pathname = url.pathname;

    // Surface the active URL filter params (f_*) so the agent doesn't have
    // to reason about the URL string or go hunting in settings for them.
    // To change a filter, use the `set-search-params` tool with these keys.
    if (url?.searchParams) {
      const activeFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(url.searchParams)) {
        if (k.startsWith("f_") && v) activeFilters[k] = v;
      }
      if (Object.keys(activeFilters).length > 0) {
        screen.activeFilters = activeFilters;
      }
    }

    const nav = navigation as any;

    if (nav?.view === "adhoc" && nav?.dashboardId) {
      try {
        const orgId = getRequestOrgId() || null;
        const email = getRequestUserEmail();
        if (email) {
          const dashboard = await getDashboard(nav.dashboardId, {
            email,
            orgId,
          });
          if (dashboard) {
            screen.dashboard = dashboard.config;
            screen.dashboardAccess = {
              role: dashboard.role,
              canEdit: dashboard.canEdit,
              canManage: dashboard.canManage,
            };
          }
        }
      } catch {
        // Dashboard config not found
      }
    } else if (nav?.view === "analyses") {
      screen.page = "analyses";
      if (nav?.analysisId) {
        screen.analysisId = nav.analysisId;
        try {
          const orgId = getRequestOrgId() || null;
          const email = getRequestUserEmail();
          if (email) {
            const analysis = await getAnalysis(nav.analysisId, {
              email,
              orgId,
            });
            if (analysis) {
              screen.analysis = {
                id: analysis.id,
                name: analysis.name,
                description: analysis.description,
                question: analysis.question,
                instructions: analysis.instructions,
                dataSources: analysis.dataSources,
                resultMarkdown: analysis.resultMarkdown,
                resultData: analysis.resultData,
                author: analysis.author,
                updatedAt: analysis.updatedAt,
                visibility: analysis.visibility,
                role: analysis.role,
                canEdit: analysis.canEdit,
                canManage: analysis.canManage,
              };
            }
          }
        } catch {
          // Analysis details not found
        }
      }
    } else if (nav?.view === "extensions") {
      screen.page = "extensions";
      if (nav?.extensionId) {
        screen.extensionId = nav.extensionId;
      }
    } else if (nav?.view === "overview" || nav?.view === "home" || !nav?.view) {
      screen.page = "overview";
    } else if (nav?.view === "ask") {
      screen.page = "ask";
    } else if (nav?.view === "query") {
      screen.page = "query";
    } else if (nav?.view === "data-sources") {
      screen.page = "data-sources";
      const email = getRequestUserEmail();
      if (email) {
        const keys = await listAnalyticsPublicKeys({
          userEmail: email,
          orgId: getRequestOrgId() || null,
        });
        screen.firstPartyAnalytics = {
          activeKeys: keys.filter((key: any) => !key.revokedAt).length,
          keys: keys.map((key: any) => ({
            id: key.id,
            name: key.name,
            publicKeyPrefix: key.publicKeyPrefix,
            revokedAt: key.revokedAt,
            lastUsedAt: key.lastUsedAt,
          })),
        };
      }
    } else if (nav?.view === "catalog") {
      screen.page = "catalog";
      const email = getRequestUserEmail();
      if (email) {
        const catalog = await listDashboardCatalog({
          email,
          orgId: getRequestOrgId() || null,
        });
        screen.dashboardTemplates = catalog.map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
          dataSources: template.dataSources,
          installed: template.installed,
          installedDashboardIds: template.installedDashboards.map(
            (dashboard) => dashboard.id,
          ),
        }));
      }
    } else if (nav?.view === "settings") {
      screen.page = "settings";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
