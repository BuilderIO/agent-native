import { defineAction } from "@agent-native/core/action";
import { analyticsPanelStatusSchema } from "@agent-native/core/shared";
import { z } from "zod";

import { requestAnalytics } from "../server/lib/analytics-peer.js";
import {
  analyticsChartDocumentIdSchema,
  authorizeAnalyticsChartPage,
  chartForPageOrganization,
} from "./_analytics-chart-access.js";

const STATUS_TIMEOUT_MS = 15_000;
const MAX_DASHBOARDS = 20;

const idSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);

export default defineAction({
  description:
    "For the Analytics charts in a page you can edit: who can open each chart's dashboard now, and each panel's current fingerprint, so a chart whose panel changed since it was copied can say so. Runs no query. Only dashboards you can open answer; the rest come back with an error.",
  schema: z.object({
    documentId: analyticsChartDocumentIdSchema,
    dashboards: z
      .array(
        z.object({
          dashboardId: idSchema,
          panelIds: z.array(idSchema).max(50).default([]),
        }),
      )
      .min(1)
      .max(MAX_DASHBOARDS),
  }),
  outputSchema: z.object({
    dashboards: z.array(
      z.union([
        z.object({
          dashboardId: z.string(),
          status: analyticsPanelStatusSchema,
        }),
        z.object({ dashboardId: z.string(), error: z.string() }),
      ]),
    ),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    // Only editors see the changed-panel note, so readers never reach Analytics.
    const page = await authorizeAnalyticsChartPage(args.documentId, "editor");
    const dashboards = await Promise.all(
      args.dashboards.map(async ({ dashboardId, panelIds }) => {
        const answer = await requestAnalytics(
          "get-dashboard-panel-status",
          { dashboardId, panelIds },
          analyticsPanelStatusSchema,
          STATUS_TIMEOUT_MS,
          page.authorityOrgId,
        );
        return answer.ok
          ? { dashboardId, status: chartForPageOrganization(answer.data, page) }
          : { dashboardId, error: answer.message };
      }),
    );
    return { dashboards };
  },
});
