import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import { readBody } from "@agent-native/core/server";
import {
  listDashboards,
  getDashboard,
  getDatasources,
  getAlertRules,
  getAlertInstances,
  queryDatasource,
} from "../lib/grafana";

export const handleGrafanaDashboards = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GRAFANA_URL", "Grafana");
    if (missing) return missing;
    try {
      const { query } = getQuery(event);
      const dashboards = await listDashboards(query as string | undefined);
      return { dashboards, total: dashboards.length };
    } catch (err: any) {
      console.error("Grafana dashboards error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleGrafanaDashboard = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GRAFANA_URL", "Grafana");
    if (missing) return missing;
    try {
      const { uid } = getQuery(event);
      if (!uid) {
        setResponseStatus(event, 400);
        return { error: "uid query parameter is required" };
      }
      const dashboard = await getDashboard(uid as string);
      return dashboard;
    } catch (err: any) {
      console.error("Grafana dashboard error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleGrafanaDatasources = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GRAFANA_URL", "Grafana");
    if (missing) return missing;
    try {
      const datasources = await getDatasources();
      return { datasources, total: datasources.length };
    } catch (err: any) {
      console.error("Grafana datasources error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleGrafanaAlerts = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GRAFANA_URL", "Grafana");
    if (missing) return missing;
    try {
      const [rules, instances] = await Promise.all([
        getAlertRules(),
        getAlertInstances(),
      ]);
      return {
        rules,
        totalRules: rules.length,
        instances,
        totalFiring: instances.filter((a) => a.state === "firing").length,
      };
    } catch (err: any) {
      console.error("Grafana alerts error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleGrafanaQuery = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GRAFANA_URL", "Grafana");
    if (missing) return missing;
    try {
      const { datasourceUid, queries, from, to } = await readBody(event);
      if (!datasourceUid || !queries) {
        setResponseStatus(event, 400);
        return { error: "datasourceUid and queries are required" };
      }
      const result = await queryDatasource(datasourceUid, queries, from, to);
      return result;
    } catch (err: any) {
      console.error("Grafana query error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
