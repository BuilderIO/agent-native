/**
 * Stream the workspace insights CSV as a downloadable file.
 *
 * Delegates to the `export-insights-csv` action for the heavy lifting so the
 * agent and the UI produce byte-identical output. This route exists purely to
 * set the right headers for a browser download — actions always return JSON.
 *
 * Route: GET /api/insights/export[?workspaceId=<id>]
 */

import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  type H3Event,
} from "h3";
import exportInsightsCsv from "../../../../actions/export-insights-csv.js";

export default defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const workspaceId =
    typeof query.workspaceId === "string" ? query.workspaceId : undefined;

  const result = await exportInsightsCsv.run({ workspaceId });

  setResponseHeader(event, "Content-Type", "text/csv; charset=utf-8");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  return result.csv;
});
