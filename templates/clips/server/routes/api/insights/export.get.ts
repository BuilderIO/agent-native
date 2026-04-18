/**
 * Stream the organization insights CSV as a downloadable file.
 *
 * Delegates to the `export-insights-csv` action for the heavy lifting so the
 * agent and the UI produce byte-identical output. This route exists purely to
 * set the right headers for a browser download — actions always return JSON.
 *
 * Route: GET /api/insights/export[?organizationId=<id>]
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
  const organizationId =
    typeof query.organizationId === "string" ? query.organizationId : undefined;

  const result = await exportInsightsCsv.run({ organizationId });

  setResponseHeader(event, "Content-Type", "text/csv; charset=utf-8");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  return result.csv;
});
