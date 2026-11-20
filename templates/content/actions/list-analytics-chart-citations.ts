import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { analyticsPanelStatusRequestSchema } from "@agent-native/core/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createdPageUrl } from "../server/lib/created-page-links.js";
import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import { ANALYTICS_CHART_TAG } from "../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../shared/analytics-charts-in-body.js";
import { accessibleDocumentIds } from "./_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";

const MAX_PAGES = 50;

const CANDIDATES_AT_ONCE = 200;

const MAX_CANDIDATES = 1_000;

const BODIES_AT_ONCE = 25;

const MAX_TITLE_CHARS = 500;

const citedPageSchema = z.object({
  id: z.string(),
  title: z.string().max(MAX_TITLE_CHARS),
  url: z.string(),
  updatedAt: z.string(),
});

async function holdsChartFrom(
  content: string | null,
  dashboardId: string,
): Promise<boolean> {
  if (
    !content?.includes(`<${ANALYTICS_CHART_TAG}`) ||
    !content.includes(dashboardId)
  ) {
    return false;
  }
  const { charts } = await analyticsChartsInBody(content);
  return charts.some((chart) => chart.dashboard.id === dashboardId);
}

function shortTitle(title: string): string {
  return title.length > MAX_TITLE_CHARS
    ? Array.from(title).slice(0, MAX_TITLE_CHARS).join("")
    : title;
}

export default defineAction({
  description:
    "The Content pages you can open that hold charts from one Analytics dashboard, most recently edited first: each page's id, title, link and last edit. At most 50; more is true when there may be others. Reads saved pages only; runs no query.",
  schema: z.object({
    dashboardId: analyticsPanelStatusRequestSchema.shape.dashboardId,
  }),
  outputSchema: z.object({
    pages: z.array(citedPageSchema),
    more: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ dashboardId }) => {
    const email = getRequestUserEmail();
    if (!email || isPublicViewerOwner(email)) {
      fail("Sign in to see the pages that cite a dashboard.", {
        errorCode: "analytics_chart_signed_out",
        statusCode: 401,
      });
    }
    const db = getDb();
    const citations = schema.analyticsChartCitations;
    const pages: z.infer<typeof citedPageSchema>[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    let exhausted = false;
    while (
      !exhausted &&
      pages.length <= MAX_PAGES &&
      scanned < MAX_CANDIDATES
    ) {
      // guard:allow-unscoped — ids only; accessibleDocumentIds below keeps the pages the caller can open before anything about them is read.
      const candidates = await db
        .select({ id: schema.documents.id })
        .from(citations)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, citations.documentId),
        )
        .where(
          and(
            eq(citations.dashboardId, dashboardId),
            isNull(schema.documents.trashedAt),
            ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
          ),
        )
        .orderBy(desc(schema.documents.updatedAt), schema.documents.id)
        .limit(CANDIDATES_AT_ONCE)
        .offset(scanned);
      scanned += candidates.length;
      exhausted = candidates.length < CANDIDATES_AT_ONCE;
      const ids = candidates.map((row) => row.id);
      const accessible = await accessibleDocumentIds(ids);
      const openable = ids.filter((id) => accessible.has(id));
      for (
        let index = 0;
        index < openable.length && pages.length <= MAX_PAGES;
        index += BODIES_AT_ONCE
      ) {
        const batch = openable.slice(index, index + BODIES_AT_ONCE);
        // guard:allow-unscoped — every id in the batch passed accessibleDocumentIds above.
        const rows = await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
            content: schema.documents.content,
            updatedAt: schema.documents.updatedAt,
          })
          .from(schema.documents)
          .where(inArray(schema.documents.id, batch));
        const byId = new Map(rows.map((row) => [row.id, row]));
        const held = await Promise.all(
          batch.map(async (id) => {
            const row = byId.get(id);
            return row && (await holdsChartFrom(row.content, dashboardId))
              ? row
              : null;
          }),
        );
        for (const row of held) {
          if (!row || seen.has(row.id)) continue;
          seen.add(row.id);
          pages.push({
            id: row.id,
            title: shortTitle(row.title),
            url: createdPageUrl(row.id),
            updatedAt: row.updatedAt,
          });
        }
      }
    }
    return {
      pages: pages.slice(0, MAX_PAGES),
      more: pages.length > MAX_PAGES || !exhausted,
    };
  },
});
