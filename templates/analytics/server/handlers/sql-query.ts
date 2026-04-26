import { defineEventHandler, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import { runQuery } from "../lib/bigquery";
import { runReport } from "../lib/google-analytics";
import { getUserSegmentation, queryEvents } from "../lib/amplitude";
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

/**
 * Amplitude panels carry a JSON blob in `sql` describing the segmentation
 * API call. Shape: { event: string; metric?: "totals"|"uniques";
 * groupBy?: string; days?: number; startDate?: string; endDate?: string }.
 */
async function runAmplitudePanel(raw: string): Promise<{
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}> {
  let parsed: {
    event?: unknown;
    metric?: unknown;
    groupBy?: unknown;
    days?: unknown;
    startDate?: unknown;
    endDate?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `amplitude panel sql must be a JSON object: ${err?.message ?? err}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("amplitude panel sql must be a JSON object");
  }
  if (typeof parsed.event !== "string" || !parsed.event.trim()) {
    throw new Error("amplitude panel requires an 'event' field");
  }

  const eventType = parsed.event.trim();
  const groupBy =
    typeof parsed.groupBy === "string" ? parsed.groupBy : undefined;

  const days =
    typeof parsed.days === "number" ? parsed.days : Number(parsed.days);
  const now = new Date();
  const startDate =
    Number.isFinite(days) && days > 0
      ? new Date(now.getTime() - days * 86_400_000)
      : new Date(now.getTime() - 30 * 86_400_000);

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const startStr =
    typeof parsed.startDate === "string" && parsed.startDate
      ? parsed.startDate.replace(/-/g, "")
      : fmt(startDate);
  const endStr =
    typeof parsed.endDate === "string" && parsed.endDate
      ? parsed.endDate.replace(/-/g, "")
      : fmt(now);

  const response = groupBy
    ? await getUserSegmentation(eventType, startStr, endStr, groupBy)
    : await queryEvents(eventType, startStr, endStr);

  return flattenAmplitudeResponse(response, groupBy);
}

function flattenAmplitudeResponse(
  response: unknown,
  groupBy?: string,
): {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
} {
  const data = (response as any)?.data;
  if (!data) return { rows: [], schema: [] };

  const xValues: string[] = Array.isArray(data.xValues) ? data.xValues : [];
  const series = data.series;

  if (!series || (Array.isArray(series) && series.length === 0)) {
    return { rows: [], schema: [] };
  }

  // Normalize YYYYMMDD xValues → YYYY-MM-DD for chart rendering
  const normDate = (d: string) =>
    /^\d{8}$/.test(d)
      ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      : d;

  if (!groupBy) {
    // No grouping — time series. series is [[n1, n2, ...]] or [{date: {value:n}}, ...]
    const firstSeries = Array.isArray(series) ? series[0] : series;
    const rows: Record<string, unknown>[] = xValues.map((dateStr, i) => {
      let count = 0;
      if (Array.isArray(firstSeries)) {
        count = typeof firstSeries[i] === "number" ? firstSeries[i] : 0;
      } else if (firstSeries && typeof firstSeries === "object") {
        const entry = (firstSeries as Record<string, any>)[dateStr];
        count = entry?.value ?? 0;
      }
      return { date: normDate(dateStr), count };
    });
    return {
      rows,
      schema: [
        { name: "date", type: "string" },
        { name: "count", type: "number" },
      ],
    };
  }

  // With groupBy — aggregate each series across dates into one row per group
  const seriesLabels: unknown[] = Array.isArray(data.seriesLabels)
    ? data.seriesLabels
    : [];
  const rows: Record<string, unknown>[] = [];

  if (Array.isArray(series)) {
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      let label = `Group ${i}`;
      if (seriesLabels[i]) {
        const entry = seriesLabels[i];
        if (Array.isArray(entry) && entry.length >= 2) {
          label = String(entry[entry.length - 1]);
        } else {
          label = String(entry);
        }
      }

      let total = 0;
      if (Array.isArray(s)) {
        for (const n of s) total += typeof n === "number" ? n : 0;
      } else if (s && typeof s === "object") {
        for (const val of Object.values(s as Record<string, any>)) {
          total += val?.value ?? (typeof val === "number" ? val : 0);
        }
      }

      rows.push({ [groupBy]: label, count: total });
    }
  }

  // Sort descending by count
  rows.sort((a, b) => (b.count as number) - (a.count as number));

  return {
    rows,
    schema: [
      { name: groupBy, type: "string" },
      { name: "count", type: "number" },
    ],
  };
}

export const handleSqlQuery = defineEventHandler(async (event) => {
  const { query, source } = await readBody(event);

  if (!query || typeof query !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing or invalid query" };
  }

  if (!source || !["bigquery", "app-db", "ga4", "amplitude"].includes(source)) {
    setResponseStatus(event, 400);
    return {
      error:
        "Invalid source. Must be 'bigquery', 'app-db', 'ga4', or 'amplitude'",
    };
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

    if (source === "amplitude") {
      const missingKey = await requireCredential(
        event,
        "AMPLITUDE_API_KEY",
        "Amplitude",
      );
      if (missingKey) return missingKey;
      const missingSecret = await requireCredential(
        event,
        "AMPLITUDE_SECRET_KEY",
        "Amplitude",
      );
      if (missingSecret) return missingSecret;
      return await runAmplitudePanel(query);
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
