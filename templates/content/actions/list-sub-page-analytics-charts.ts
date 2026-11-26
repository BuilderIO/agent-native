import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { analyticsChartSchema } from "../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../shared/analytics-charts-in-body.js";
import { analyticsChartDocumentIdSchema } from "./_analytics-chart-access.js";
import { readSubPagesGoingPublic } from "./_sub-pages-going-public.js";

/** A chart without its rows: what the share dialog weighs. */
const subPageChartSchema = analyticsChartSchema.pick({
  panel: true,
  dashboard: true,
});

export default defineAction({
  description:
    "For a page you can share: the Analytics charts in the sub-pages that would go public with it, so the share dialog can ask before their numbers reach more people than their dashboards. Reads saved pages only; runs no query.",
  schema: z.object({ documentId: analyticsChartDocumentIdSchema }),
  outputSchema: z.object({
    charts: z.array(subPageChartSchema),
    /** Chart tags in those sub-pages that don't read as charts. */
    unreadable: z.number(),
    /** More sub-pages than a change can carry; such a change is refused. */
    more: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async ({ documentId }) => {
    const { found, more } = await readSubPagesGoingPublic(
      documentId,
      analyticsChartsInBody,
    );
    const charts: z.infer<typeof subPageChartSchema>[] = [];
    let unreadable = 0;
    for (const page of found) {
      unreadable += page.unreadable;
      for (const chart of page.charts) {
        charts.push({ panel: chart.panel, dashboard: chart.dashboard });
      }
    }
    return { charts, unreadable, more };
  },
});
