import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getFirstPartyDrilldown } from "../server/lib/first-party-metric-catalog";
import { PANEL_DRILLDOWN_MAX_SQL_LENGTH } from "../shared/panel-drilldown";

export default defineAction({
  agentTool: false,
  readOnly: true,
  http: { method: "POST" },
  description:
    "Return a panel's declared record-level drill-down SQL template, the first-party catalog template, or null when the panel only has aggregate rows. Templates use {{drillX}} and {{drillSeries}} for the clicked chart point plus dashboard filter variables.",
  schema: z.object({
    panelId: z.string().min(1).max(200),
    panelSource: z.string().min(1).max(100),
    panelSql: z.string().min(1).max(50_000),
    drilldown: z
      .object({
        sql: z
          .string()
          .max(PANEL_DRILLDOWN_MAX_SQL_LENGTH)
          .refine((sql) => sql.trim().length > 0)
          .describe(
            "Record-level SQL template using drillX, drillSeries and dashboard filter variables; at most 50000 characters.",
          ),
      })
      .strict()
      .nullish()
      .describe(
        "Panel config.drilldown declaration for BigQuery or first-party SQL; omit to use catalog lookup or aggregate fallback.",
      ),
  }),
  run: async ({ panelId, panelSource, panelSql, drilldown }) => {
    if (
      drilldown &&
      panelSource !== "bigquery" &&
      panelSource !== "first-party"
    ) {
      fail(
        "Declared record drill-down SQL requires a BigQuery or first-party panel.",
        { errorCode: "unsupported_drilldown_source", statusCode: 422 },
      );
    }
    return {
      drilldown:
        drilldown ?? getFirstPartyDrilldown(panelId, panelSource, panelSql),
    };
  },
});
