import { defineAction } from "@agent-native/core";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { listAnalyticsAlertRules } from "../server/lib/analytics-alerts";
import { listDashboardCatalog } from "../server/lib/dashboard-catalog";
import { getAnalysis, getDashboard } from "../server/lib/dashboards-store";
import { getErrorIssue, listErrorIssues } from "../server/lib/error-capture.js";
import { listAnalyticsPublicKeys } from "../server/lib/first-party-analytics.js";
import {
  getSessionReplaySummary,
  listSessionRecordings,
  replayRangeToIso,
  type ReplayRange,
} from "../server/lib/session-replay.js";
import {
  getStatusPagePreview,
  listStatusPages,
} from "../server/lib/status-pages.js";
import { getMonitor, listMonitors } from "../server/lib/uptime-monitors.js";

const SESSION_FILTER_KEYS = new Set(["range", "app", "q"]);
const REPLAY_RANGES = new Set(["24h", "7d", "30d", "90d", "all"]);

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, dashboard config (if on a dashboard), analysis details (if on an analysis), Analytics session replay context, and any active URL filter params. Prefer the auto-included <current-screen> block; call this only when you need a refreshed snapshot.",
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
    const selectedObject = await readAppState("selected-object");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (url?.pathname) screen.pathname = url.pathname;
    if (selectedObject) screen.selectedObject = selectedObject;

    // Surface the active URL filter params (f_*) so the agent doesn't have
    // to reason about the URL string or go hunting in settings for them.
    // To change a filter, use the `set-search-params` tool with these keys.
    if (url?.searchParams) {
      const activeFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(url.searchParams)) {
        if (k.startsWith("f_") && v) activeFilters[k] = v;
        if (
          url.pathname?.startsWith("/sessions") &&
          SESSION_FILTER_KEYS.has(k) &&
          v
        ) {
          activeFilters[k] = v;
        }
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
    } else if (nav?.view === "sessions") {
      screen.page = nav?.recordingId ? "session-replay-detail" : "sessions";
      const email = getRequestUserEmail();
      if (email) {
        const scope = { userEmail: email, orgId: getRequestOrgId() || null };
        try {
          if (nav?.recordingId) {
            screen.sessionReplay = await getSessionReplaySummary(
              nav.recordingId,
              scope,
            );
          } else {
            const params = url?.searchParams ?? {};
            const sessions = await listSessionRecordings(scope, {
              from:
                replayRangeToIso(readReplayRange(params.range)) ?? undefined,
              app: params.app,
              query: params.q,
              limit: 25,
            });
            screen.sessionReplays = sessions;
          }
        } catch (error: any) {
          screen.sessionReplayError = error?.message || String(error);
        }
      }
    } else if (nav?.view === "monitoring") {
      screen.page = "monitoring";
      const monitoringView =
        nav?.monitoringView === "errors" ? "errors" : "uptime";
      screen.monitoringView = monitoringView;
      screen.monitoringSurfaces = [
        {
          id: "uptime",
          label: "Uptime",
          path: "/monitoring",
          includes: [
            "synthetic HTTP/status uptime checks",
            "latency + body/header assertions",
            "incidents",
            "down/degraded alerting",
          ],
        },
        {
          id: "status-pages",
          label: "Status pages",
          path: "/monitoring?statuspage=list",
          includes: [
            "public status page config (under the uptime subview)",
            "monitor selection + ordering",
            "publish / slug management",
            "public URL /status/<slug>",
          ],
        },
        {
          id: "errors",
          label: "Errors",
          path: "/monitoring?view=errors",
          includes: [
            "captured JavaScript exceptions",
            "grouped error issues",
            "linked session replays",
          ],
        },
      ];
      const email = getRequestUserEmail();
      if (email) {
        const orgId = getRequestOrgId() || null;
        try {
          if (monitoringView === "errors") {
            if (nav?.errorIssueId) {
              screen.errorIssueId = nav.errorIssueId;
              const detail = await getErrorIssue(
                { userEmail: email, orgId },
                nav.errorIssueId,
              );
              const issue = detail.issue;
              const sample = detail.events[0];
              screen.errorIssue = {
                id: issue.id,
                title: issue.title,
                type: issue.type,
                culprit: issue.culprit,
                level: issue.level,
                status: issue.status,
                firstSeenAt: issue.firstSeenAt,
                lastSeenAt: issue.lastSeenAt,
                eventCount: issue.eventCount,
                usersAffected: issue.usersAffected,
                recentFrequency: issue.sparkline,
                assignee: issue.assignee,
                app: issue.app,
                template: issue.template,
                lastSessionRecordingPath: issue.lastSessionRecordingPath,
                sampleEvent: sample
                  ? {
                      message: sample.message,
                      culprit: sample.culprit,
                      handled: sample.handled,
                      url: sample.url,
                      occurredAt: sample.occurredAt,
                      sessionRecordingPath: sample.sessionRecordingPath,
                      stack: sample.stack.slice(0, 8),
                      rawStackPreview: sample.rawStack
                        ? sample.rawStack.split("\n").slice(0, 8).join("\n")
                        : null,
                    }
                  : null,
                linkedSessions: detail.sessions.slice(0, 5),
              };
            } else {
              const issues = await listErrorIssues(
                { userEmail: email, orgId },
                { status: "unresolved", limit: 25 },
              );
              screen.errorIssues = issues.map((issue) => ({
                id: issue.id,
                title: issue.title,
                culprit: issue.culprit,
                level: issue.level,
                status: issue.status,
                eventCount: issue.eventCount,
                usersAffected: issue.usersAffected,
                lastSeenAt: issue.lastSeenAt,
              }));
            }
          } else if (nav?.statusPageId) {
            // Status pages are a config sub-view under the uptime panel.
            screen.uptimeSubview = "status-pages";
            if (nav.statusPageId === "new") {
              screen.statusPageMode = "create";
            } else if (nav.statusPageId === "list") {
              const pages = await listStatusPages({ email, orgId });
              screen.statusPages = pages.map((page) => ({
                id: page.id,
                slug: page.slug,
                title: page.title,
                published: page.published,
                monitorCount: page.monitors.length,
                publicUrl: `/status/${page.slug}`,
                updatedAt: page.updatedAt,
              }));
            } else {
              screen.statusPageId = nav.statusPageId;
              const preview = await getStatusPagePreview(nav.statusPageId, {
                email,
                orgId,
              });
              if (preview) {
                const { page, view } = preview;
                screen.statusPage = {
                  id: page.id,
                  slug: page.slug,
                  title: page.title,
                  description: page.description,
                  published: page.published,
                  publicUrl: `/status/${page.slug}`,
                  layout: {
                    density: page.density,
                    alignment: page.alignment,
                    showUptimeBars: page.showUptimeBars,
                    showOverallUptime: page.showOverallUptime,
                    showResponseTime: page.showResponseTime,
                  },
                  monitorCount: page.monitors.length,
                  overall: view.overall,
                  counts: view.counts,
                  includedMonitors: view.monitors.map((monitor) => ({
                    id: monitor.id,
                    name: monitor.name,
                    host: monitor.host,
                    status: monitor.status,
                    uptime24h: monitor.windows.uptime24h,
                    uptime7d: monitor.windows.uptime7d,
                  })),
                  updatedAt: page.updatedAt,
                };
              }
            }
          } else if (nav?.monitorId === "new") {
            screen.monitorMode = "create";
          } else if (nav?.monitorId) {
            screen.monitorId = nav.monitorId;
            const detail = await getMonitor(nav.monitorId, { email, orgId });
            if (detail) {
              const monitor = detail.monitor;
              const openIncidents = detail.incidents.filter(
                (incident) => !incident.resolvedAt,
              );
              screen.monitor = {
                id: monitor.id,
                name: monitor.name,
                url: monitor.url,
                method: monitor.method,
                enabled: monitor.enabled,
                severity: monitor.severity,
                intervalSeconds: monitor.intervalSeconds,
                lastStatus: monitor.lastStatus,
                lastCheckedAt: monitor.lastCheckedAt,
                lastSuccessAt: monitor.lastSuccessAt,
                lastError: monitor.lastError,
                lastLatencyMs: monitor.lastLatencyMs,
                lastStatusCode: monitor.lastStatusCode,
                consecutiveFailures: monitor.consecutiveFailures,
                uptime24h: monitor.uptime24h,
                uptime7d: monitor.uptime7d,
                checks24h: monitor.checks24h,
                openIncidentCount: openIncidents.length,
                recentIncidents: detail.incidents
                  .slice(0, 5)
                  .map((incident) => ({
                    id: incident.id,
                    startedAt: incident.startedAt,
                    resolvedAt: incident.resolvedAt,
                    status: incident.status,
                    severity: incident.severity,
                    cause: incident.cause,
                  })),
              };
            }
          } else {
            const monitors = await listMonitors({ email, orgId });
            screen.monitors = monitors.map((monitor) => ({
              id: monitor.id,
              name: monitor.name,
              url: monitor.url,
              enabled: monitor.enabled,
              lastStatus: monitor.lastStatus,
              lastCheckedAt: monitor.lastCheckedAt,
              uptime24h: monitor.uptime24h,
              uptime7d: monitor.uptime7d,
            }));
          }
        } catch (error: any) {
          screen.monitoringError = error?.message || String(error);
        }
      }
    } else if (nav?.view === "overview" || nav?.view === "home" || !nav?.view) {
      screen.page = "ask";
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
    } else if (nav?.view === "agents") {
      screen.page = "agents";
      screen.agentsView = nav?.agentsView || "monitoring";
      if (nav?.dbAdminConnectionId) {
        screen.dbAdminConnectionId = nav.dbAdminConnectionId;
      }
      screen.agentAdminSurfaces = [
        {
          id: "monitoring",
          label: "Monitoring",
          path: "/agents",
          includes: [
            "agent traces",
            "agent conversations",
            "eval results",
            "experiments",
            "feedback",
          ],
        },
        {
          id: "dashboards",
          label: "Dashboard Usage",
          path: "/agents?view=dashboards",
          adminOnly: true,
          action: "list-dashboard-usage-stats",
          includes: [
            "dashboard created and modified dates",
            "last tracked modifier",
            "view and engagement counts",
            "saved view counts",
            "hidden and archived state",
          ],
        },
        {
          id: "database",
          label: "App Databases",
          path: "/agents?view=database",
          advanced: true,
          adminOnly: true,
          includes: [
            "connected agent-native app databases",
            "table browser",
            "row editor",
            "SQL editor",
          ],
        },
      ];
      if (screen.agentsView === "dashboards") {
        screen.dashboardUsageStatsAction = "list-dashboard-usage-stats";
      }
      const email = getRequestUserEmail();
      if (email) {
        const orgId = getRequestOrgId() || null;
        const [keys, catalog] = await Promise.all([
          listAnalyticsPublicKeys({
            userEmail: email,
            orgId,
          }),
          listDashboardCatalog({
            email,
            orgId,
          }),
        ]);
        const llmTemplate = catalog.find(
          (template) => template.id === "agent-observability-llm",
        );
        screen.firstPartyAnalytics = {
          activeKeys: keys.filter((key: any) => !key.revokedAt).length,
          serverEnv: "AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
          browserEnv: "VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
        };
        if (llmTemplate) {
          screen.llmObservabilityDashboard = {
            templateId: llmTemplate.id,
            name: llmTemplate.name,
            installed: llmTemplate.installed,
            installedDashboardIds: llmTemplate.installedDashboards.map(
              (dashboard) => dashboard.id,
            ),
          };
        }
      }
    } else if (nav?.view === "settings") {
      screen.page = "settings";
      const email = getRequestUserEmail();
      if (email) {
        const orgId = getRequestOrgId() || null;
        const alertRules = await listAnalyticsAlertRules({ email, orgId });
        screen.analyticsAlerts = alertRules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          severity: rule.severity,
          eventName: rule.eventName,
          filters: rule.filters,
          thresholdMode: rule.thresholdMode,
          distinctBy: rule.distinctBy,
          threshold: rule.threshold,
          windowMinutes: rule.windowMinutes,
          cooldownMinutes: rule.cooldownMinutes,
          channels: rule.channels,
          emailRecipients: rule.emailRecipients,
          lastStatus: rule.lastStatus,
          lastEvaluatedAt: rule.lastEvaluatedAt,
          lastTriggeredAt: rule.lastTriggeredAt,
          lastError: rule.lastError,
        }));
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});

function readReplayRange(value: unknown): ReplayRange {
  return typeof value === "string" && REPLAY_RANGES.has(value)
    ? (value as ReplayRange)
    : "30d";
}
