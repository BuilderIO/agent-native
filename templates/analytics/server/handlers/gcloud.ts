import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential, resolveCredential } from "../lib/credentials";
import {
  listCloudRunServices,
  listCloudFunctions,
  getServiceMetrics,
  listLogEntries,
} from "../lib/gcloud";

// Known Cloud Run services to show as fallback when service listing is denied.
// Replace these with your own Cloud Run service names.
const KNOWN_CLOUD_RUN_SERVICES = ["api-service", "web-app", "worker"];

export const handleGCloudServices = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "BIGQUERY_PROJECT_ID",
    "Google Cloud",
  );
  if (missing) return missing;
  try {
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
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      // Return known services as fallback
      const projectId =
        (await resolveCredential("BIGQUERY_PROJECT_ID")) ||
        "your-gcp-project-id";
      const knownCloudRun = KNOWN_CLOUD_RUN_SERVICES.map((name) => ({
        name: `projects/${projectId}/locations/us-central1/services/${name}`,
        uid: "",
        displayName: name,
        uri: "",
        region: "us-central1",
        createTime: "",
        updateTime: "",
      }));
      return {
        cloudRun: knownCloudRun,
        cloudFunctions: [],
        totalCloudRun: knownCloudRun.length,
        totalCloudFunctions: 0,
        permissionWarning:
          "Service listing permission denied. Showing known services. " +
          "Grant the service account 'run.viewer' and 'cloudfunctions.viewer' roles for full discovery.",
      };
    }

    console.error("GCloud services error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const handleGCloudMetrics = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "BIGQUERY_PROJECT_ID",
    "Google Cloud",
  );
  if (missing) return missing;
  try {
    const {
      service,
      metric,
      period: periodParam,
      type: typeParam,
      extraFilter: extraFilterParam,
    } = getQuery(event);
    const period = (periodParam as string) || "24h";
    const type = (typeParam as string) || "cloud_run";
    const extraFilter = (extraFilterParam as string) || undefined;

    if (!service || !metric) {
      setResponseStatus(event, 400);
      return { error: "service and metric query parameters are required" };
    }

    const serviceType =
      type === "cloud_function" ? "cloud_function" : "cloud_run";
    const timeSeries = await getServiceMetrics(
      serviceType,
      service as string,
      metric as string,
      period,
      extraFilter,
    );
    return { timeSeries, total: timeSeries.length };
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      return {
        timeSeries: [],
        total: 0,
        permissionWarning:
          "Monitoring API permission denied. Grant 'monitoring.viewer' role to the service account.",
      };
    }

    console.error("GCloud metrics error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const handleGCloudLogs = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "BIGQUERY_PROJECT_ID",
    "Google Cloud",
  );
  if (missing) return missing;
  try {
    const {
      service,
      severity,
      limit: limitParam,
      type: typeParam,
    } = getQuery(event);
    const limit = parseInt((limitParam as string) || "100", 10);
    const type = (typeParam as string) || "cloud_run";

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
      filterParts.push(`severity >= "${(severity as string).toUpperCase()}"`);
    }

    const filter =
      filterParts.join(" AND ") || 'resource.type = "cloud_run_revision"';
    const entries = await listLogEntries(filter, Math.min(limit, 500));
    return { entries, total: entries.length };
  } catch (err: any) {
    const isPermissionDenied =
      err.message?.includes("Permission") ||
      err.message?.includes("403") ||
      err.message?.includes("denied");

    if (isPermissionDenied) {
      return {
        entries: [],
        total: 0,
        permissionWarning:
          "Logging API permission denied. Grant 'logging.viewer' role to the service account.",
      };
    }

    console.error("GCloud logs error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
