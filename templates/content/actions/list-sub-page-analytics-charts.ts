import { defineAction, fail } from "@agent-native/core/action";
import {
  MAX_PUBLIC_FOLLOWERS,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { z } from "zod";

import { publicSubPageIds } from "../server/lib/public-sub-pages.js";
import { analyticsChartSchema } from "../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../shared/analytics-charts-in-body.js";
import { analyticsChartDocumentIdSchema } from "./_analytics-chart-access.js";
import { resolveDocumentAccess } from "./_document-access.js";

/** Sub-pages read at once, as core checks a page's followers. */
const SUB_PAGES_AT_ONCE = 10;

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
    const page = await resolveDocumentAccess(documentId, {
      skipResourceBody: true,
    });
    if (!page || page.resource.trashedAt) {
      fail("Page not found", {
        errorCode: "document_not_found",
        statusCode: 404,
      });
    }
    if (!roleSatisfies(page.role, "admin")) {
      fail("Only people who can share this page can see this.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    }
    // The sub-pages that aren't public yet go public with the page. Core
    // carries only the ones the caller can share, read with its own access
    // check (not Content's space fallback), so only those count here.
    const ids = await publicSubPageIds(page.resource, { isPublic: false });
    const more = ids.length > MAX_PUBLIC_FOLLOWERS;
    const charts: z.infer<typeof subPageChartSchema>[] = [];
    let unreadable = 0;
    const carried = ids.slice(0, MAX_PUBLIC_FOLLOWERS);
    for (let index = 0; index < carried.length; index += SUB_PAGES_AT_ONCE) {
      const read = await Promise.all(
        carried
          .slice(index, index + SUB_PAGES_AT_ONCE)
          .map(async (subPageId) => {
            const access = await resolveAccess("document", subPageId);
            if (!access || !roleSatisfies(access.role, "admin")) return null;
            if (access.resource.visibility === "public") return null;
            const content = access.resource.content;
            return analyticsChartsInBody(
              typeof content === "string" ? content : null,
            );
          }),
      );
      for (const found of read) {
        if (!found) continue;
        unreadable += found.unreadable;
        for (const chart of found.charts) {
          charts.push({ panel: chart.panel, dashboard: chart.dashboard });
        }
      }
    }
    return { charts, unreadable, more };
  },
});
