import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  analyticsPanelCaptureRequestSchema,
  parseAnalyticsPanelLink,
  type EmbedAudienceReason,
} from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  analyticsLinkOrigins,
  requestAnalytics,
} from "../server/lib/analytics-peer.js";
import {
  analyticsChartAudience,
  analyticsChartBlockRaw,
  analyticsChartSchema,
  ANALYTICS_CHART_BLOCK_TYPE,
  type AnalyticsChartData,
} from "../shared/analytics-chart-block.js";
import { isRegistryBlockId } from "../shared/nfm-registry.js";
import {
  analyticsChartDocumentIdSchema,
  authorizeAnalyticsChartPage,
} from "./_analytics-chart-access.js";

// Analytics answers within 55 seconds; leave room for the hop.
const CAPTURE_TIMEOUT_MS = 58_000;

// Analytics fits a copy to 49,000 characters of pretty-printed JSON. As one
// escaped string inside this result it can grow, so allow more room here.
const CAPTURE_MAX_RESULT_CHARS = 75_000;

/** The editor draws the chart from its numbers; agents place the tag. */
function isEditorCall(ctx: ActionRunContext | undefined): boolean {
  return ctx?.caller === "frontend" || ctx?.caller === "http";
}

function newBlockId(): string {
  return `${ANALYTICS_CHART_BLOCK_TYPE}-${crypto.randomUUID().slice(0, 8)}`;
}

function audienceMessage(
  reason: EmbedAudienceReason,
  chart: AnalyticsChartData,
): string {
  const dashboard = `the ${chart.dashboard.title} dashboard`;
  if (reason === "public-page") {
    return `Anyone with the link can open this page, but not ${dashboard}, so its panels can't be added here. Narrow the page's sharing first.`;
  }
  if (chart.panel.type === "table") {
    return `More people can open this page than ${dashboard}. A table lists its rows, so it can't go in a page more people can open than its dashboard.`;
  }
  return `More people can open this page than ${dashboard}. Everyone who can open the page will see this chart's numbers.`;
}

const audienceSchema = z.object({
  verdict: z.enum(["ok", "warn", "block"]),
  reason: z.enum(["public-page", "wider", "unknown-source"]).nullable(),
});

// The copy goes out once: as numbers to the editor, or as the tag to agents.
const outputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    blockId: z.string(),
    chart: analyticsChartSchema.optional(),
    audience: audienceSchema,
    analyticsChartTag: z.string().optional(),
    next: z.string(),
  }),
  z.object({
    status: z.literal("needs_confirmation"),
    blockId: z.string(),
    chart: analyticsChartSchema.optional(),
    audience: audienceSchema,
    message: z.string(),
    next: z.string(),
  }),
]);

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    'Copy one Analytics dashboard panel (line, area, bar, combo, pie, funnel, metric or table) into a page as a chart block. Pass the panel\'s copied link from Analytics, or its dashboardId, panelId and filters. Checks you can edit the page, then has Analytics run the panel as you, with your access, and returns the AnalyticsChart tag, holding its numbers, to put in the page with edit-document. To refresh a chart already in the page, pass purpose "refresh" and its blockId, then replace the old tag with the new one. A chart from a dashboard fewer people can open than the page comes back as needs_confirmation: ask the person first, then call again with acknowledgeWiderAudience. Tables, and any panel going into a page anyone with the link can open, never go wider than their dashboard.',
  schema: z.object({
    documentId: analyticsChartDocumentIdSchema,
    link: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .describe(
        "The panel's copied link from Analytics (Copy link on the panel), e.g. https://…/dashboards/<id>?f_timeRange=90d&tile=<panelId>.",
      ),
    dashboardId: analyticsPanelCaptureRequestSchema.shape.dashboardId
      .optional()
      .describe("Dashboard id, when there is no link."),
    panelId: analyticsPanelCaptureRequestSchema.shape.panelId
      .optional()
      .describe("Panel id, when there is no link."),
    filters: analyticsPanelCaptureRequestSchema.shape.filters,
    purpose: z
      .enum(["insert", "refresh"])
      .default("insert")
      .describe("insert for a new chart; refresh for one already in the page."),
    blockId: z
      .string()
      .refine(isRegistryBlockId, "Not a block id")
      .optional()
      .describe("The chart's block id, to refresh it in place."),
    acknowledgeWiderAudience: z
      .boolean()
      .optional()
      .describe(
        "Set only after the person agreed that everyone who can open the page may see this chart's numbers.",
      ),
  }),
  outputSchema,
  http: { method: "POST" },
  maxResultChars: CAPTURE_MAX_RESULT_CHARS,
  readOnly: true,
  run: async (args, ctx) => {
    const page = await authorizeAnalyticsChartPage(args.documentId, "editor");

    const request = args.link
      ? parseAnalyticsPanelLink(args.link, analyticsLinkOrigins())
      : args.dashboardId && args.panelId
        ? {
            dashboardId: args.dashboardId,
            panelId: args.panelId,
            ...(args.filters ? { filters: args.filters } : {}),
          }
        : null;
    if (!request) {
      fail(
        args.link
          ? "That isn't a panel link from this workspace's Analytics. Use Copy link on the dashboard panel."
          : "Pass the panel's link, or its dashboardId and panelId.",
        { errorCode: "analytics_chart_link_invalid", statusCode: 400 },
      );
    }

    const answer = await requestAnalytics(
      "capture-dashboard-panel",
      request,
      analyticsChartSchema,
      CAPTURE_TIMEOUT_MS,
    );
    if (!answer.ok) {
      fail(answer.message, {
        errorCode: answer.code,
        statusCode:
          answer.code === "analytics_signed_out"
            ? 401
            : answer.code === "analytics_refused"
              ? 409
              : 502,
      });
    }
    const chart = answer.data;
    const audience = analyticsChartAudience("insert", page.visibility, chart);
    const blockId = args.blockId ?? newBlockId();
    const forEditor = isEditorCall(ctx);

    track(
      args.purpose === "refresh"
        ? "analytics_chart_refreshed"
        : "analytics_chart_captured",
      {
        app_name: "content",
        template_name: "content",
        output_type: "analytics_chart",
        panel_type: chart.panel.type,
        row_count: chart.rows.length,
        truncated: chart.truncated,
        page_visibility: page.visibility,
        dashboard_visibility: chart.dashboard.visibility,
        audience_verdict: audience.verdict,
      },
      ctx,
    );

    if (audience.verdict === "block" && audience.reason) {
      fail(audienceMessage(audience.reason, chart), {
        errorCode: "analytics_chart_wider_than_dashboard",
        statusCode: 409,
        details: { reason: audience.reason, panelType: chart.panel.type },
      });
    }
    if (
      audience.verdict === "warn" &&
      audience.reason &&
      args.acknowledgeWiderAudience !== true
    ) {
      return {
        status: "needs_confirmation" as const,
        blockId,
        ...(forEditor ? { chart } : {}),
        audience,
        message: audienceMessage(audience.reason, chart),
        next: "Tell the person who can open the page and the dashboard, and call again with acknowledgeWiderAudience only if they agree.",
      };
    }
    if (forEditor) {
      return {
        status: "captured" as const,
        blockId,
        chart,
        audience,
        next: "Draw the chart in the page.",
      };
    }
    const result = {
      status: "captured" as const,
      blockId,
      audience,
      analyticsChartTag: analyticsChartBlockRaw(blockId, chart),
      next:
        args.purpose === "refresh"
          ? "Replace the chart's old AnalyticsChart tag (same id) with analyticsChartTag using edit-document."
          : "Put analyticsChartTag in the page where the chart belongs with edit-document, as its own block, and leave the tag as it is.",
    };
    // A cut-off tag can't be placed, so say so rather than hand over half.
    if (
      ctx?.maxResultChars !== undefined &&
      JSON.stringify(result, null, 2).length > ctx.maxResultChars
    ) {
      fail(
        "This chart is too large for the agent to place. Paste the panel's link into the page instead.",
        { errorCode: "analytics_chart_too_large", statusCode: 413 },
      );
    }
    return result;
  },
});
