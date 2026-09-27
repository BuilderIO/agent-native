import { defineAction, fail } from "@agent-native/core/action";
import {
  currentRequestUserIsOrgAdmin,
  getAppConfig,
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server";
import { z } from "zod";

import { resolveDefaultFilterVars } from "../app/pages/adhoc/sql-dashboard/filter-vars";
import { interpolate } from "../app/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "../app/pages/adhoc/sql-dashboard/panel-sql";
import { repairKnownFirstPartyDashboardQueries } from "../server/lib/canonical-first-party-dashboard-repair";
import {
  isDashboardPanelSource,
  normalizeDashboardPanelQuery,
} from "../server/lib/dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "../server/lib/dashboard-panel-source-resolver";
import { getDashboardForReview } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Load the first saved Analytics dashboard panel for Human Review using the dashboard's own organization-scoped data connections. Requires an organization admin; cross-organization reads are limited to the configured observability super organization.",
  schema: z
    .object({
      dashboardId: z.string().min(1).max(200),
      panelId: z.string().min(1).max(200),
    })
    .strict(),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async ({ dashboardId, panelId }) => {
    const email = getRequestUserEmail();
    const activeOrgId = getRequestOrgId();
    if (
      !email ||
      !activeOrgId ||
      !(await currentRequestUserIsOrgAdmin(activeOrgId))
    ) {
      fail(
        "Only organization owners and admins can preview reviewed dashboards.",
        {
          statusCode: 403,
        },
      );
    }

    const scope =
      getAppConfig().observability.superOrgId === activeOrgId
        ? { kind: "super-organization" as const }
        : { kind: "organization" as const, orgId: activeOrgId };
    const dashboard = await getDashboardForReview(dashboardId, scope);
    if (!dashboard || dashboard.kind !== "sql" || !dashboard.orgId) {
      fail("Dashboard not found.", { statusCode: 404 });
    }
    const config = repairKnownFirstPartyDashboardQueries(
      dashboard.id,
      dashboard.config,
    ).config;
    const panels = Array.isArray(config.panels)
      ? config.panels.filter(
          (value): value is Record<string, unknown> =>
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value),
        )
      : [];
    const panel = panels.find((candidate) => candidate.id === panelId);
    const source = panel?.source;
    if (
      !panel ||
      !isDashboardPanelSource(source) ||
      typeof panel.sql !== "string" ||
      panel.chartType === "section" ||
      panel.chartType === "extension" ||
      panel.source === "program" ||
      panel.source === "demo"
    ) {
      fail("Dashboard panel not found or cannot be previewed.", {
        statusCode: 404,
      });
    }

    const variables = resolveDefaultFilterVars(dashboard.config);
    if (!variables) {
      fail("Dashboard filters cannot be read.", { statusCode: 422 });
    }
    const resolvedSql = interpolate(serializePanelSql(panel.sql), variables, {
      failClosedTimeVariables: true,
    });
    const query = normalizeDashboardPanelQuery(source, resolvedSql);
    const crossOrganizationPreview =
      scope.kind === "super-organization" && dashboard.orgId !== activeOrgId;
    const credentialContext = {
      userEmail: email,
      orgId: dashboard.orgId,
      ...(crossOrganizationPreview ? { credentialScope: "org" as const } : {}),
    };
    const context = {
      ...getRequestContext(),
      userEmail: email,
      orgId: dashboard.orgId,
      ...(crossOrganizationPreview ? { credentialScope: "org" as const } : {}),
    };
    return runWithRequestContext(context, () =>
      resolveAnalyticsPanelSource({ source, query }, credentialContext),
    );
  },
});
