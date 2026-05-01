import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getAlertInstances,
  getAlertRules,
  getDashboard,
  getDatasources,
  listDashboards,
  queryDatasource,
} from "../server/lib/grafana";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Grafana dashboards, datasources, alerts, or a datasource query. Use this for Grafana observability questions.",
  schema: z.object({
    mode: z
      .enum(["dashboards", "dashboard", "datasources", "alerts", "query"])
      .default("dashboards")
      .describe("What to query from Grafana"),
    search: z.string().optional().describe("Dashboard search query"),
    uid: z.string().optional().describe("Dashboard UID for mode=dashboard"),
    datasourceUid: z
      .string()
      .optional()
      .describe("Datasource UID for mode=query"),
    queries: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Grafana datasource query objects for mode=query"),
    from: z.string().optional().describe("Query start time in epoch ms"),
    to: z.string().optional().describe("Query end time in epoch ms"),
  }),
  readOnly: true,
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["GRAFANA_URL", "GRAFANA_API_TOKEN"],
      "Grafana",
    );
    if (!credentials.ok) return credentials.response;

    try {
      if (args.mode === "dashboard") {
        if (!args.uid) return { error: "uid is required" };
        return await getDashboard(args.uid);
      }

      if (args.mode === "datasources") {
        const datasources = await getDatasources();
        return { datasources, total: datasources.length };
      }

      if (args.mode === "alerts") {
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
      }

      if (args.mode === "query") {
        if (!args.datasourceUid || !args.queries) {
          return { error: "datasourceUid and queries are required" };
        }
        return await queryDatasource(
          args.datasourceUid,
          args.queries,
          args.from,
          args.to,
        );
      }

      const dashboards = await listDashboards(args.search);
      return { dashboards, total: dashboards.length };
    } catch (err) {
      return providerError(err);
    }
  },
});
