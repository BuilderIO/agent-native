import { defineAction, embedApp, fail } from "@agent-native/core";
import {
  currentRequestUserIsOrgAdmin,
  getAppConfig,
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import type { DashboardAnnotations } from "../app/pages/adhoc/sql-dashboard/types";
import {
  buildDashboardAgentContext,
  buildDashboardSeedAgentContext,
  isAgentContextCaller,
} from "../server/lib/agent-readable-resource-context";
import { repairKnownFirstPartyDashboardQueries } from "../server/lib/canonical-first-party-dashboard-repair";
import { loadDashboardAnnotationSummary } from "../server/lib/dashboard-annotation-reads";
import { storedDashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import {
  getDashboard,
  getDashboardForReview,
} from "../server/lib/dashboards-store";
import { listKeyDateSets } from "../server/lib/key-dates-store";
import { keyDateEvents } from "../shared/key-dates";

export default defineAction({
  description:
    "Get a SQL analytics dashboard by ID. By default this returns compact panel summaries (chart type, `bindings` naming the result columns each chart is bound to, SQL size and hash), layout/order fields, certification, and a `revision`, without SQL strings. Pass `panelIds` to get the full SQL and config of just those panels in `panelDetails`. Use includeConfig=true only to review the whole dashboard; past ~12k characters it returns summaries with `truncated: true` and `omittedPanelIds`.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    includeConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config including every panel's SQL. Defaults to false to keep agent context compact; prefer panelIds.",
      ),
    panelIds: z
      .array(z.string())
      .max(25)
      .optional()
      .describe(
        "Panel ids to return in full (SQL and config) under `panelDetails`; unknown ids come back in `missingPanelIds`. Every other panel stays a compact summary.",
      ),
    reviewPreview: z
      .boolean()
      .optional()
      .describe(
        "Human Review only: read a saved dashboard for an organization owner/admin. Cross-organization reads are limited to the single organization configured as this app's observability super organization.",
      ),
    reviewOrgId: z
      .string()
      .min(1)
      .optional()
      .describe("The customer organization shown in this Human Review row."),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: id },
      }),
      label: "Open dashboard in Analytics",
      view: "adhoc",
    };
  },
  run: async (args, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };

    const detail = {
      includeConfig: args.includeConfig === true,
      panelIds: args.panelIds,
      forAgent: isAgentContextCaller(actionContext?.caller),
    };

    let dash;
    if (args.reviewPreview) {
      if (!orgId || !(await currentRequestUserIsOrgAdmin(orgId))) {
        fail(
          "Only organization owners and admins can preview reviewed dashboards.",
          { statusCode: 403 },
        );
      }
      const superOrgId = getAppConfig().observability.superOrgId;
      const isSuperOrg = superOrgId === orgId;
      const targetOrgId = isSuperOrg ? args.reviewOrgId : orgId;
      if (!targetOrgId) {
        fail(
          "A customer organization is required for this dashboard preview.",
          {
            statusCode: 400,
          },
        );
      }
      dash = await getDashboardForReview(
        args.id,
        isSuperOrg
          ? { kind: "super-organization", orgId: targetOrgId }
          : { kind: "organization", orgId: targetOrgId },
      );
    } else {
      dash = await getDashboard(args.id, ctx);
    }
    if (args.reviewPreview && (!dash || dash.kind !== "sql")) {
      fail("Dashboard not found.", { statusCode: 404 });
    }
    if (!dash || dash.kind !== "sql") {
      const seed = loadDashboardSeed(args.id);
      if (seed) {
        const config = repairKnownFirstPartyDashboardQueries(
          args.id,
          seed,
        ).config;
        return buildDashboardSeedAgentContext(args.id, config, {
          ...detail,
          annotationSummary: detail.forAgent
            ? await loadDashboardAnnotationSummary(
                { scope: ctx, editable: true },
                args.id,
                config,
              )
            : undefined,
        });
      }
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }
    const dashboard = {
      ...dash,
      config: repairKnownFirstPartyDashboardQueries(args.id, dash.config)
        .config,
    };
    const annotationScope = storedDashboardAnnotationScope(dashboard, ctx);
    const context = buildDashboardAgentContext(dashboard, {
      ...detail,
      annotationSummary:
        detail.forAgent && !args.reviewPreview
          ? await loadDashboardAnnotationSummary(
              annotationScope,
              args.id,
              dashboard.config as Record<string, unknown>,
            )
          : undefined,
    });
    if (!args.reviewPreview) return context;
    // The reviewer may be in another organization, so list-key-dates would
    // return their key dates, not the ones this dashboard draws.
    return {
      ...context,
      keyDates: keyDateEvents(
        await listKeyDateSets(annotationScope.scope),
        dashboard.config.annotations as DashboardAnnotations | undefined,
      ),
    };
  },
});
