import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getServiceMetrics,
  listCloudFunctions,
  listCloudRunServices,
  listLogEntries,
} from "../server/lib/gcloud";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Google Cloud Run/Cloud Functions services, Cloud Monitoring metrics, and Cloud Logging entries.",
  schema: z.object({
    mode: z
      .enum(["services", "metrics", "logs"])
      .default("services")
      .describe("What to query from Google Cloud"),
    service: z
      .string()
      .optional()
      .describe("Cloud Run service or Cloud Function name"),
    serviceType: z
      .enum(["cloud_run", "cloud_function"])
      .default("cloud_run")
      .describe("Resource type for metrics/logs"),
    metric: z
      .string()
      .optional()
      .describe("Cloud Monitoring metric type for mode=metrics"),
    period: z
      .enum(["1h", "6h", "24h", "7d"])
      .default("24h")
      .describe("Metric lookback period"),
    severity: z
      .string()
      .optional()
      .describe("Minimum log severity for mode=logs"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Maximum log entries for mode=logs"),
    extraFilter: z
      .string()
      .optional()
      .describe("Additional Cloud Monitoring filter expression"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["BIGQUERY_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS_JSON"],
      "Google Cloud",
    );
    if (!credentials.ok) return credentials.response;

    try {
      if (args.mode === "metrics") {
        if (!args.service || !args.metric) {
          return { error: "service and metric are required" };
        }
        const timeSeries = await getServiceMetrics(
          args.serviceType,
          args.service,
          args.metric,
          args.period,
          args.extraFilter,
        );
        return { timeSeries, total: timeSeries.length };
      }

      if (args.mode === "logs") {
        const filterParts: string[] = [];
        if (args.service) {
          if (args.serviceType === "cloud_function") {
            filterParts.push(
              `resource.type = "cloud_function" AND resource.labels.function_name = "${args.service}"`,
            );
          } else {
            filterParts.push(
              `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${args.service}"`,
            );
          }
        }
        if (args.severity) {
          filterParts.push(`severity >= "${args.severity.toUpperCase()}"`);
        }
        const filter =
          filterParts.join(" AND ") || 'resource.type = "cloud_run_revision"';
        const entries = await listLogEntries(filter, args.limit);
        return { entries, total: entries.length };
      }

      const [cloudRun, cloudFunctions] = await Promise.all([
        listCloudRunServices(),
        listCloudFunctions(),
      ]);
      return {
        cloudRun,
        cloudFunctions,
        totalCloudRun: cloudRun.length,
        totalCloudFunctions: cloudFunctions.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/permission|403|denied/i.test(message)) {
        return {
          error: message,
          permissionWarning:
            "Google Cloud permissions are missing. Grant the service account viewer roles for the requested API, then retry.",
        };
      }
      return providerError(err);
    }
  },
});
