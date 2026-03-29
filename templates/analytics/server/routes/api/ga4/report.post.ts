import { defineEventHandler, readBody, createError } from "h3";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { metrics, dimensions, startDate, endDate } = body as {
    metrics?: string[];
    dimensions?: string[];
    startDate?: string;
    endDate?: string;
  };

  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "metrics required" });
  }

  const propertyId = process.env.GA4_PROPERTY_ID;
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!propertyId || !credsJson) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "GA4 not configured. Set GA4_PROPERTY_ID and GOOGLE_APPLICATION_CREDENTIALS_JSON.",
    });
  }

  const { runReport } = await import("../../../lib/google-analytics");

  const report = await runReport(dimensions ?? [], metrics, {
    startDate: startDate ?? "7daysAgo",
    endDate: endDate ?? "today",
  });

  return {
    dimensionHeaders: report.dimensionHeaders ?? [],
    metricHeaders: report.metricHeaders ?? [],
    rows: report.rows ?? [],
    rowCount: report.rowCount ?? 0,
  };
});
