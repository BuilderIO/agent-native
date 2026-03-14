import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  listDashboards,
  getDashboard,
  getDatasources,
  getAlertRules,
  getAlertInstances,
  queryDatasource,
} from "../lib/grafana";

export const handleGrafanaDashboards: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GRAFANA_URL", "Grafana")) return;
  try {
    const dashboards = await listDashboards(req.query.query as string | undefined);
    res.json({ dashboards, total: dashboards.length });
  } catch (err: any) {
    console.error("Grafana dashboards error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGrafanaDashboard: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GRAFANA_URL", "Grafana")) return;
  try {
    const uid = req.query.uid as string;
    if (!uid) {
      res.status(400).json({ error: "uid query parameter is required" });
      return;
    }
    const dashboard = await getDashboard(uid);
    res.json(dashboard);
  } catch (err: any) {
    console.error("Grafana dashboard error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGrafanaDatasources: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "GRAFANA_URL", "Grafana")) return;
  try {
    const datasources = await getDatasources();
    res.json({ datasources, total: datasources.length });
  } catch (err: any) {
    console.error("Grafana datasources error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGrafanaAlerts: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "GRAFANA_URL", "Grafana")) return;
  try {
    const [rules, instances] = await Promise.all([
      getAlertRules(),
      getAlertInstances(),
    ]);
    res.json({
      rules,
      totalRules: rules.length,
      instances,
      totalFiring: instances.filter((a) => a.state === "firing").length,
    });
  } catch (err: any) {
    console.error("Grafana alerts error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGrafanaQuery: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GRAFANA_URL", "Grafana")) return;
  try {
    const { datasourceUid, queries, from, to } = req.body;
    if (!datasourceUid || !queries) {
      res.status(400).json({ error: "datasourceUid and queries are required" });
      return;
    }
    const result = await queryDatasource(datasourceUid, queries, from, to);
    res.json(result);
  } catch (err: any) {
    console.error("Grafana query error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
