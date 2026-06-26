import type { CredentialContext } from "@agent-native/core/credentials";
import { resolveCredential } from "@agent-native/core/credentials";
import type { MissingKeyResponse } from "@agent-native/core/server";

import { getUserSegmentation, queryEvents } from "./amplitude";
import { queryAppTables } from "./app-sql";
import { runQuery } from "./bigquery";
import { runDemoPanel, serializeDemoDescriptorInput } from "./demo-source";
import { queryFirstPartyAnalytics } from "./first-party-analytics";
import { runReport } from "./google-analytics";
import {
  runPrometheusPanel,
  serializePanelDescriptorInput,
} from "./prometheus";

export const DASHBOARD_PANEL_SOURCES = [
  "bigquery",
  "ga4",
  "amplitude",
  "first-party",
  "app",
  "demo",
  "prometheus",
] as const;

export type DashboardPanelSource = (typeof DASHBOARD_PANEL_SOURCES)[number];

export interface DashboardPanelQueryResult {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}

export function isDashboardPanelSource(
  value: unknown,
): value is DashboardPanelSource {
  return (
    typeof value === "string" &&
    DASHBOARD_PANEL_SOURCES.includes(value as DashboardPanelSource)
  );
}

export function normalizeDashboardPanelQuery(
  source: DashboardPanelSource,
  rawQuery: unknown,
): string {
  if (source === "prometheus" || source === "demo") {
    if (rawQuery === undefined || rawQuery === null || rawQuery === "") {
      throw new Error("Missing or invalid query");
    }
    return source === "demo"
      ? serializeDemoDescriptorInput(rawQuery)
      : serializePanelDescriptorInput(rawQuery);
  }

  if (!rawQuery || typeof rawQuery !== "string") {
    throw new Error("Missing or invalid query");
  }
  return rawQuery;
}

async function missingCredential(
  ctx: CredentialContext,
  key: string,
  label: string,
): Promise<MissingKeyResponse | null> {
  const value = await resolveCredential(key, ctx);
  if (value) return null;
  return {
    error: "missing_api_key",
    key,
    label,
    message: `Connect your ${label} account to see this data`,
    settingsPath: "/data-sources",
  };
}

/**
 * ga4 panels carry a JSON blob in `sql` describing the GA4 Data API call.
 * Shape: { metrics: string[]; dimensions?: string[]; days?: number;
 *          startDate?: string; endDate?: string }.
 */
async function runGa4Panel(raw: string): Promise<DashboardPanelQueryResult> {
  let parsed: {
    metrics?: unknown;
    dimensions?: unknown;
    days?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    filter?: unknown;
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

  const dimensionFilter =
    parsed.filter && typeof parsed.filter === "object"
      ? (parsed.filter as Record<string, unknown>)
      : undefined;

  const report = await runReport(
    dimensions,
    metrics,
    { startDate, endDate },
    dimensionFilter,
  );

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
 * Amplitude panels carry a JSON blob in `sql` describing the segmentation API
 * call. Shape: { event: string; metric?: "totals"|"uniques"; groupBy?: string;
 * days?: number; startDate?: string; endDate?: string }.
 */
async function runAmplitudePanel(
  raw: string,
): Promise<DashboardPanelQueryResult> {
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
): DashboardPanelQueryResult {
  const data = (response as any)?.data;
  if (!data) return { rows: [], schema: [] };

  const xValues: string[] = Array.isArray(data.xValues) ? data.xValues : [];
  const series = data.series;

  if (!series || (Array.isArray(series) && series.length === 0)) {
    return { rows: [], schema: [] };
  }

  const normDate = (d: string) =>
    /^\d{8}$/.test(d)
      ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      : d;

  if (!groupBy) {
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

  rows.sort((a, b) => (b.count as number) - (a.count as number));

  return {
    rows,
    schema: [
      { name: groupBy, type: "string" },
      { name: "count", type: "number" },
    ],
  };
}

export async function runDashboardPanelQuery(args: {
  source: DashboardPanelSource;
  query: string;
  ctx: CredentialContext;
}): Promise<DashboardPanelQueryResult | MissingKeyResponse> {
  const { source, query, ctx } = args;

  if (source === "bigquery") {
    const missing = await missingCredential(
      ctx,
      "BIGQUERY_PROJECT_ID",
      "BigQuery",
    );
    if (missing) return missing;
    return await runQuery(query);
  }

  if (source === "ga4") {
    const missingProp = await missingCredential(
      ctx,
      "GA4_PROPERTY_ID",
      "Google Analytics",
    );
    if (missingProp) return missingProp;
    const missingCreds = await missingCredential(
      ctx,
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "Google Analytics",
    );
    if (missingCreds) return missingCreds;
    return await runGa4Panel(query);
  }

  if (source === "amplitude") {
    const missingKey = await missingCredential(
      ctx,
      "AMPLITUDE_API_KEY",
      "Amplitude",
    );
    if (missingKey) return missingKey;
    const missingSecret = await missingCredential(
      ctx,
      "AMPLITUDE_SECRET_KEY",
      "Amplitude",
    );
    if (missingSecret) return missingSecret;
    return await runAmplitudePanel(query);
  }

  if (source === "first-party") {
    return await queryFirstPartyAnalytics(query, {
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? null,
    });
  }

  if (source === "app") {
    return await queryAppTables(query, {
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? null,
    });
  }

  if (source === "demo") {
    return await runDemoPanel(query);
  }

  if (source === "prometheus") {
    const missingUrl = await missingCredential(
      ctx,
      "PROMETHEUS_URL",
      "Prometheus",
    );
    if (missingUrl) return missingUrl;
    return await runPrometheusPanel(query);
  }

  throw new Error("Unsupported source");
}
