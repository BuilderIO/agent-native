import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  listCloudRunServices,
  listCloudFunctions,
  getServiceMetrics,
  listLogEntries,
} from "../lib/gcloud";

// Known Cloud Run services to show as fallback when service listing is denied.
// Replace these with your own Cloud Run service names.
const KNOWN_CLOUD_RUN_SERVICES = [
  "api-service",
  "web-app",
  "worker",
];

export const handleGCloudServices: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "BIGQUERY_PROJECT_ID", "Google Cloud")) return;
  try {
    const [cloudRun, cloudFunctions] = await Promise.all([
      listCloudRunServices(),
      listCloudFunctions(),
    ]);
    res.json({
      cloudRun,
      cloudFunctions,
      totalCloudRun: cloudRun.length,
      totalCloudFunctions: cloudFunctions.length,
    });
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      // Return known services as fallback
      const knownCloudRun = KNOWN_CLOUD_RUN_SERVICES.map((name) => ({
        name: `projects/${process.env.BIGQUERY_PROJECT_ID || "your-gcp-project-id"}/locations/us-central1/services/${name}`,
        uid: "",
        displayName: name,
        uri: "",
        region: "us-central1",
        createTime: "",
        updateTime: "",
      }));
      res.json({
        cloudRun: knownCloudRun,
        cloudFunctions: [],
        totalCloudRun: knownCloudRun.length,
        totalCloudFunctions: 0,
        permissionWarning:
          "Service listing permission denied. Showing known services. " +
          "Grant the service account 'run.viewer' and 'cloudfunctions.viewer' roles for full discovery.",
      });
      return;
    }

    console.error("GCloud services error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGCloudMetrics: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "BIGQUERY_PROJECT_ID", "Google Cloud")) return;
  try {
    const service = req.query.service as string;
    const metric = req.query.metric as string;
    const period = (req.query.period as string) || "24h";
    const type = (req.query.type as string) || "cloud_run";
    const extraFilter = (req.query.extraFilter as string) || undefined;

    if (!service || !metric) {
      res
        .status(400)
        .json({ error: "service and metric query parameters are required" });
      return;
    }

    const serviceType =
      type === "cloud_function" ? "cloud_function" : "cloud_run";
    const timeSeries = await getServiceMetrics(
      serviceType,
      service,
      metric,
      period,
      extraFilter,
    );
    res.json({ timeSeries, total: timeSeries.length });
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      res.json({
        timeSeries: [],
        total: 0,
        permissionWarning:
          "Monitoring API permission denied. Grant 'monitoring.viewer' role to the service account.",
      });
      return;
    }

    console.error("GCloud metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGCloudLogs: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "BIGQUERY_PROJECT_ID", "Google Cloud")) return;
  try {
    const service = req.query.service as string;
    const severity = req.query.severity as string;
    const limit = parseInt((req.query.limit as string) || "100", 10);
    const type = (req.query.type as string) || "cloud_run";

    const filterParts: string[] = [];

    if (service) {
      if (type === "cloud_function") {
        filterParts.push(
          `resource.type = "cloud_function" AND resource.labels.function_name = "${service}"`,
        );
      } else {
        filterParts.push(
          `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${service}"`,
        );
      }
    }

    if (severity) {
      filterParts.push(`severity >= "${severity.toUpperCase()}"`);
    }

    const filter =
      filterParts.join(" AND ") || 'resource.type = "cloud_run_revision"';
    const entries = await listLogEntries(filter, Math.min(limit, 500));
    res.json({ entries, total: entries.length });
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      res.json({
        entries: [],
        total: 0,
        permissionWarning:
          "Logging API permission denied. Grant 'logging.viewer' role to the service account.",
      });
      return;
    }

    console.error("GCloud logs error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
