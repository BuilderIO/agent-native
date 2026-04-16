import { defineEventHandler, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import { runQuery } from "../lib/bigquery";
import { runReport } from "../lib/google-analytics";
import { getDbExec } from "@agent-native/core/db";
import { readBody } from "@agent-native/core/server";

/**
 * ga4 panels carry a JSON blob in `sql` describing the GA4 Data API call.
 * Shape: { metrics: string[]; dimensions?: string[]; days?: number;
 *          startDate?: string; endDate?: string }. Dates are resolved from
 * `days` when startDate/endDate are omitted so seeded dashboards can use
 * the simpler `{"days": 30}` form.
 */
async function runGa4Panel(raw: string): Promise<{
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}> {
  let parsed: {
    metrics?: unknown;
    dimensions?: unknown;
    days?: unknown;
    startDate?: unknown;
    endDate?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `ga4 panel sql must be a JSON object with metrics/dimensions/days: ${err?.message ?? err}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("ga4 panel sql must be a JSON object");
  }
  const metrics = Array.isArray(parsed.metrics)
    ? parsed.metrics.filter((m): m is string => typeof m === "string")
    : [];
  if (metrics.length === 0) {
    throw new Error("ga4 panel requires at least one metric");
  }
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.filter((d): d is string => typeof d === "string")
    : [];
  const days =
    typeof parsed.days === "number" ? parsed.days : Number(parsed.days);
  const startDate =
    typeof parsed.startDate === "string" && parsed.startDate
      ? parsed.startDate
      : Number.isFinite(days) && days > 0
        ? `${days}daysAgo`
        : "7daysAgo";
  const endDate =
    typeof parsed.endDate === "string" && parsed.endDate
      ? parsed.endDate
      : "today";

  const report = await runReport(dimensions, metrics, { startDate, endDate });

  // Flatten each GA4 row to { dimensionName: value, metricName: value } so
  // downstream chart renderers treat it identically to SQL rows. Metrics are
  // parsed to numbers since every chart type (metric card, bar, line, table)
  // relies on numeric typing for y-axis detection.
  const rows: Record<string, unknown>[] = (report.rows ?? []).map((row) => {
    const out: Record<string, unknown> = {};
    dimensions.forEach((name, i) => {
      out[name] = row.dimensionValues?.[i]?.value ?? "";
    });
    metrics.forEach((name, i) => {
      const raw = row.metricValues?.[i]?.value ?? "0";
      const num = Number(raw);
      out[name] = Number.isFinite(num) ? num : raw;
    });
    return out;
  });

  const schema = [
    ...dimensions.map((name) => ({ name, type: "string" })),
    ...metrics.map((name) => ({ name, type: "number" })),
  ];
  return { rows, schema };
}

export const handleSqlQuery = defineEventHandler(async (event) => {
  const { query, source } = await readBody(event);

  if (!query || typeof query !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing or invalid query" };
  }

  if (!source || !["bigquery", "app-db", "ga4"].includes(source)) {
    setResponseStatus(event, 400);
    return { error: "Invalid source. Must be 'bigquery', 'app-db', or 'ga4'" };
  }

  try {
    if (source === "bigquery") {
      const missing = await requireCredential(
        event,
        "BIGQUERY_PROJECT_ID",
        "BigQuery",
      );
      if (missing) return missing;
      const result = await runQuery(query);
      return result;
    }

    if (source === "ga4") {
      const missingProp = await requireCredential(
        event,
        "GA4_PROPERTY_ID",
        "Google Analytics",
      );
      if (missingProp) return missingProp;
      const missingCreds = await requireCredential(
        event,
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        "Google Analytics",
      );
      if (missingCreds) return missingCreds;
      return await runGa4Panel(query);
    }

    // app-db: strict read-only enforcement
    const trimmed = query.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
      setResponseStatus(event, 400);
      return { error: "Only SELECT queries are allowed for app-db" };
    }
    const forbiddenPattern =
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|PRAGMA|LOAD_EXTENSION|VACUUM|REINDEX)\b/i;
    if (forbiddenPattern.test(query)) {
      setResponseStatus(event, 400);
      return { error: "Only SELECT queries are allowed for app-db" };
    }
    // Block semicolons to prevent statement stacking
    if (query.includes(";")) {
      const statementsBeforeSemicolon = query
        .split(";")
        .filter((s) => s.trim());
      if (statementsBeforeSemicolon.length > 1) {
        setResponseStatus(event, 400);
        return { error: "Multiple statements are not allowed" };
      }
    }

    const client = getDbExec();
    const { rows } = await client.execute(query);
    const schema =
      rows.length > 0
        ? Object.keys(rows[0] as Record<string, unknown>).map((name) => ({
            name,
            type: typeof (rows[0] as Record<string, unknown>)[name],
          }))
        : [];
    return { rows, schema };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`SQL query error (${source}):`, message);
    setResponseStatus(event, 400);
    return { error: message };
  }
});
