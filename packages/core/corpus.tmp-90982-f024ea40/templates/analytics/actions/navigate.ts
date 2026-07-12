import { defineAction } from "@agent-native/core";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardSummaries } from "../server/lib/dashboards-store";

function normalizeDashboardName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function resolveDashboardIdByName(name: string): Promise<string> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("Dashboard navigation requires authentication.");
  const orgId = getRequestOrgId() || null;
  const dashboards = await listDashboardSummaries(
    { email, orgId },
    { kind: "sql", archived: "active", hidden: "visible" },
  );
  const normalized = normalizeDashboardName(name);
  const withoutDashboardSuffix = normalized.replace(/\s+dashboard$/, "");
  const matches = dashboards.filter((dashboard) => {
    const candidate = normalizeDashboardName(dashboard.name);
    return candidate === normalized || candidate === withoutDashboardSuffix;
  });
  if (matches.length === 0) {
    throw new Error(
      `No accessible dashboard named "${name.trim()}" was found.`,
    );
  }
  if (matches.length === 1) return matches[0]!.id;

  const ownedMatches = matches.filter(
    (dashboard) => dashboard.ownerEmail.toLowerCase() === email.toLowerCase(),
  );
  if (ownedMatches.length === 1) return ownedMatches[0]!.id;
  throw new Error(
    `More than one accessible dashboard is named "${name.trim()}". Use its dashboard id instead.`,
  );
}

export default defineAction({
  description:
    "Navigate the UI to a specific view, dashboard, analysis, extension, Analytics session recording, Monitoring tab (uptime checks, public status pages, or captured errors), or Analytics agent-admin surface. For filter changes (dashboard filter query params like ?f_date=... or session filters like ?range=30d&q=signup), use the framework-level `set-search-params` tool instead of this action.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (ask, adhoc, analyses, extensions, sessions, monitoring, agents, catalog, data-dictionary, data-sources, settings)",
      ),
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard ID to open (used with view=adhoc)"),
    dashboardName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Accessible SQL dashboard name to open when its id is unknown (for example, "Agent Native" or "Agent Native dashboard").',
      ),
    analysisId: z
      .string()
      .optional()
      .describe("Analysis ID to open (used with view=analyses)"),
    extensionId: z
      .string()
      .optional()
      .describe("Extension ID to open (used with view=extensions)"),
    recordingId: z
      .string()
      .optional()
      .describe("Session recording id to open (used with view=sessions)"),
    agentsView: z
      .enum(["monitoring", "dashboards", "database"])
      .optional()
      .describe(
        "Admin subview to open (monitoring, dashboard usage, or app databases)",
      ),
    dbAdminConnectionId: z
      .string()
      .optional()
      .describe(
        "Connected app database id to select when navigating to agentsView=database",
      ),
    monitoringView: z
      .enum(["uptime", "errors"])
      .optional()
      .describe(
        "Monitoring tab subview to open (uptime checks or captured errors). Used with view=monitoring; defaults to uptime.",
      ),
    monitorId: z
      .string()
      .optional()
      .describe(
        'Uptime monitor id to open (used with view=monitoring; implies the uptime subview). Pass "new" to open the create-monitor form.',
      ),
    statusPageId: z
      .string()
      .optional()
      .describe(
        'Public status page to open in the uptime subview\'s Status pages config (used with view=monitoring; implies the uptime subview). Pass "list" for the index, "new" for the create form, or a status page id to edit that page.',
      ),
    errorIssueId: z
      .string()
      .optional()
      .describe(
        "Captured error issue id to open (used with view=monitoring; implies the errors subview).",
      ),
  }),
  http: false,
  run: async (args) => {
    if (
      !args.view &&
      !args.dashboardId &&
      !args.dashboardName &&
      !args.analysisId &&
      !args.extensionId &&
      !args.recordingId &&
      !args.agentsView &&
      !args.dbAdminConnectionId &&
      !args.monitoringView &&
      !args.monitorId &&
      !args.statusPageId &&
      !args.errorIssueId
    ) {
      throw new Error(
        "At least --view, --dashboardId, --dashboardName, --analysisId, --extensionId, --recordingId, --agentsView, --dbAdminConnectionId, --monitoringView, --monitorId, --statusPageId, or --errorIssueId is required.",
      );
    }
    const dashboardId =
      args.dashboardId ??
      (args.dashboardName
        ? await resolveDashboardIdByName(args.dashboardName)
        : undefined);
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view === "overview" ? "ask" : args.view;
    if (dashboardId) {
      nav.dashboardId = dashboardId;
      if (!args.view) nav.view = "adhoc";
    }
    if (args.analysisId) {
      nav.analysisId = args.analysisId;
      if (!args.view) nav.view = "analyses";
    }
    if (args.extensionId) {
      nav.extensionId = args.extensionId;
      if (!args.view) nav.view = "extensions";
    }
    if (args.recordingId) {
      nav.recordingId = args.recordingId;
      if (!args.view) nav.view = "sessions";
    }
    if (args.agentsView) {
      nav.agentsView = args.agentsView;
      if (!args.view) nav.view = "agents";
    }
    if (args.dbAdminConnectionId) {
      nav.dbAdminConnectionId = args.dbAdminConnectionId;
      nav.agentsView = "database";
      if (!args.view) nav.view = "agents";
    }
    if (args.monitoringView) {
      nav.monitoringView = args.monitoringView;
      if (!args.view) nav.view = "monitoring";
    }
    if (args.monitorId) {
      nav.monitorId = args.monitorId;
      // Monitors live under the uptime subview.
      nav.monitoringView = "uptime";
      if (!args.view) nav.view = "monitoring";
    }
    if (args.statusPageId) {
      nav.statusPageId = args.statusPageId;
      // Status pages are configured under the uptime subview.
      nav.monitoringView = "uptime";
      if (!args.view) nav.view = "monitoring";
    }
    if (args.errorIssueId) {
      nav.errorIssueId = args.errorIssueId;
      // Error issues live under the errors subview.
      nav.monitoringView = "errors";
      if (!args.view) nav.view = "monitoring";
    }
    await writeAppStateForCurrentTab("navigate", nav);

    const parts: string[] = [];
    if (nav.view) parts.push(nav.view);
    if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
    if (nav.analysisId) parts.push(`analysis:${nav.analysisId}`);
    if (nav.extensionId) parts.push(`extension:${nav.extensionId}`);
    if (nav.recordingId) parts.push(`recording:${nav.recordingId}`);
    if (nav.agentsView) parts.push(`agents:${nav.agentsView}`);
    if (nav.dbAdminConnectionId)
      parts.push(`db-admin:${nav.dbAdminConnectionId}`);
    if (nav.monitoringView) parts.push(`monitoring:${nav.monitoringView}`);
    if (nav.monitorId) parts.push(`monitor:${nav.monitorId}`);
    if (nav.statusPageId) parts.push(`status-page:${nav.statusPageId}`);
    if (nav.errorIssueId) parts.push(`issue:${nav.errorIssueId}`);
    return `Navigating to ${parts.join(" ")}`;
  },
});
