import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  queryInstant,
  queryRange,
  listLabels,
  listLabelValues,
  listSeries,
  listMetricMetadata,
  listAlerts,
} from "../server/lib/prometheus";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Prometheus directly: instant PromQL, range PromQL (time series), labels, label values, series matchers, metric metadata, and firing alerts.",
  schema: z.object({
    mode: z
      .enum([
        "query",
        "query_range",
        "labels",
        "label_values",
        "series",
        "metadata",
        "alerts",
      ])
      .default("query")
      .describe("Prometheus API endpoint to call"),
    query: z.string().optional().describe("PromQL for mode=query|query_range"),
    time: z
      .string()
      .optional()
      .describe("RFC3339 evaluation time for mode=query"),
    start: z.string().optional().describe("RFC3339 start for mode=query_range"),
    end: z.string().optional().describe("RFC3339 end for mode=query_range"),
    step: z
      .string()
      .optional()
      .describe(
        'Step like "30s" or "5m" for mode=query_range; auto if omitted',
      ),
    label: z.string().optional().describe("Label name for mode=label_values"),
    match: z
      .array(z.string())
      .optional()
      .describe("Series matchers for mode=series, e.g. ['up{job=\"api\"}']"),
    metric: z.string().optional().describe("Metric name for mode=metadata"),
  }),
  readOnly: true,
  run: async (args) => {
    const creds = await requireActionCredentials(
      ["PROMETHEUS_URL"],
      "Prometheus",
    );
    if (creds.ok === false) return creds.response;

    try {
      if (args.mode === "query") {
        if (!args.query) return { error: "query is required for mode=query" };
        const data = await queryInstant(args.query, args.time);
        return { resultType: (data as any).resultType, data };
      }

      if (args.mode === "query_range") {
        if (!args.query) {
          return { error: "query is required for mode=query_range" };
        }
        if (!args.start || !args.end) {
          return { error: "start and end are required for mode=query_range" };
        }
        const startSec = Math.floor(new Date(args.start).getTime() / 1000);
        const endSec = Math.floor(new Date(args.end).getTime() / 1000);
        const stepSec = parseStepSec(
          args.step ?? `${defaultStepFor(endSec - startSec)}s`,
        );
        const data = await queryRange(args.query, startSec, endSec, stepSec);
        return { resultType: (data as any).resultType, data };
      }

      if (args.mode === "labels") {
        const labels = await listLabels();
        return { labels, total: labels.length };
      }

      if (args.mode === "label_values") {
        if (!args.label) {
          return { error: "label is required for mode=label_values" };
        }
        const values = await listLabelValues(args.label);
        return { values, total: values.length };
      }

      if (args.mode === "series") {
        if (!args.match || args.match.length === 0) {
          return { error: "match is required for mode=series" };
        }
        const series = await listSeries(args.match);
        return { series, total: series.length };
      }

      if (args.mode === "metadata") {
        return { metadata: await listMetricMetadata(args.metric) };
      }

      return { alerts: await listAlerts() };
    } catch (err) {
      return providerError(err);
    }
  },
});

function defaultStepFor(rangeSec: number): number {
  return Math.max(15, Math.floor(rangeSec / 250));
}

function parseStepSec(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) throw new Error(`invalid step: ${s}`);
  const n = parseInt(m[1], 10);
  return n * { s: 1, m: 60, h: 3600 }[m[2] as "s" | "m" | "h"];
}
