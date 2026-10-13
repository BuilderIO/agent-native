import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  createError,
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

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  const result = await runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () => exportInsightsCsv.run({ organizationId }),
  );

  setResponseHeader(event, "Content-Type", "text/csv; charset=utf-8");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  return result.csv;
});
