import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import type {
  DashboardAnnotations,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { dashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope.js";
import type { DashboardRecord } from "../server/lib/dashboards-store.js";
import {
  listKeyDateSets,
  requireKeyDateScope,
} from "../server/lib/key-dates-store.js";
import { drawsKeyDates, type KeyDateSet } from "../shared/key-dates.js";

/**
 * Another organization's sets as one of its dashboards shows them: none
 * where no chart draws key dates, no member emails, and none it hides unless
 * the reader can show them again.
 */
function setsForReader(
  sets: readonly KeyDateSet[],
  dashboard: DashboardRecord,
): KeyDateSet[] {
  const config = dashboard.config as {
    panels?: SqlPanel[];
    annotations?: DashboardAnnotations;
  };
  if (!drawsKeyDates(config.panels ?? [])) return [];
  const hidden = new Set(
    dashboard.canEdit ? [] : config.annotations?.hiddenKeyDateSets,
  );
  return sets
    .filter((set) => !hidden.has(set.id))
    .map(({ createdBy: _, dates, ...set }) => ({
      ...set,
      dates: dates.map(({ addedBy: __, ...date }) => date),
    }));
}

export default defineAction({
  description:
    "List the organization's key-date sets (for example Launches, Product changes) by name, each with its dates oldest first. Every set shows on every time chart of every dashboard unless that dashboard hides it in config.annotations.hiddenKeyDateSets. Read-only.",
  schema: z.object({
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "List the sets this dashboard draws: its owner organization's. editable is false when they aren't yours to change.",
      ),
    reviewPreview: z
      .boolean()
      .optional()
      .describe(
        "Human Review only: with dashboardId, list what a reviewed dashboard draws, read as get-sql-dashboard's reviewPreview reads it",
      ),
    reviewOrgId: z
      .string()
      .min(1)
      .optional()
      .describe("The customer organization shown in this Human Review row."),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async ({ dashboardId, reviewPreview, reviewOrgId }) => {
    const caller = requireKeyDateScope();
    if (reviewPreview && !dashboardId) {
      fail("reviewPreview needs the dashboardId of the reviewed dashboard.", {
        statusCode: 400,
      });
    }
    if (!dashboardId) {
      return { sets: await listKeyDateSets(caller), editable: true };
    }
    const drawn = await dashboardAnnotationScope(
      dashboardId,
      caller,
      reviewPreview ? { reviewOrgId } : undefined,
    );
    const sets = await listKeyDateSets(drawn.scope);
    return drawn.editable
      ? { sets, editable: true }
      : { sets: setsForReader(sets, drawn.dashboard), editable: false };
  },
});
