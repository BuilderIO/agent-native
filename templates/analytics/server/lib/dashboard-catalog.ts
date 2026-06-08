import type { SqlDashboardConfig } from "../../app/pages/adhoc/sql-dashboard/types";
import { loadDashboardSeed } from "./dashboard-seeds";
import { listDashboards, type DashboardRecord } from "./dashboards-store";

export type DashboardTemplateCategory =
  | "Acquisition"
  | "Product"
  | "Observability"
  | "Operations";

export interface DashboardCatalogMetadata {
  id: string;
  name: string;
  description: string;
  category: DashboardTemplateCategory;
  defaultDashboardId: string;
  dataSources: Array<"first-party" | "ga4" | "prometheus">;
  tags: string[];
  panelCount: number;
  version: string;
  recommended?: boolean;
}

export type CatalogDashboardConfig = SqlDashboardConfig & {
  catalog?: {
    templateId: string;
    templateVersion: string;
    installedAt: string;
  };
};

export type DashboardCatalogEntry = DashboardCatalogMetadata & {
  buildConfig: () => SqlDashboardConfig;
};

export type InstalledDashboardSummary = {
  id: string;
  name: string;
  visibility: DashboardRecord["visibility"];
  updatedAt: string;
  archivedAt: string | null;
};

export type DashboardCatalogTemplate = DashboardCatalogMetadata & {
  installedDashboards: InstalledDashboardSummary[];
  installed: boolean;
};

interface AccessCtx {
  email: string;
  orgId: string | null;
}

const CATALOG_VERSION = "2026-06-08";

function seedConfig(id: string): SqlDashboardConfig {
  const seed = loadDashboardSeed(id);
  if (!seed) throw new Error(`Dashboard seed not found: ${id}`);
  return seed as unknown as SqlDashboardConfig;
}

function promPanelSql(
  promql: string,
  options: {
    mode?: "instant" | "range";
    range?: string;
    step?: string;
  } = {},
): string {
  return JSON.stringify({
    promql,
    mode: options.mode ?? "range",
    ...(options.range ? { range: options.range } : {}),
    ...(options.step ? { step: options.step } : {}),
  });
}

function prometheusMetricPanel({
  id,
  title,
  promql,
  description,
  yFormatter,
}: {
  id: string;
  title: string;
  promql: string;
  description: string;
  yFormatter?: "number" | "percent";
}) {
  return {
    id,
    title,
    chartType: "metric" as const,
    source: "prometheus" as const,
    width: 1,
    sql: promPanelSql(promql, { mode: "instant" }),
    config: {
      yKey: "value",
      ...(yFormatter ? { yFormatter } : {}),
      description,
    },
  };
}

function prometheusSeriesPanel({
  id,
  title,
  promql,
  description,
  yFormatter,
  chartType = "line",
  width = 2,
  range = "6h",
  step = "1m",
}: {
  id: string;
  title: string;
  promql: string;
  description: string;
  yFormatter?: "number" | "percent";
  chartType?: "line" | "area" | "bar";
  width?: number;
  range?: string;
  step?: string;
}) {
  return {
    id,
    title,
    chartType,
    source: "prometheus" as const,
    width,
    sql: promPanelSql(promql, { range, step }),
    config: {
      xKey: "timestamp",
      yKey: "value",
      ...(yFormatter ? { yFormatter } : {}),
      description,
      pivot: {
        xKey: "timestamp",
        seriesKey: "series",
        valueKey: "value",
      },
      legend: true,
    },
  };
}

function buildNodeExporterEssentials(): SqlDashboardConfig {
  return {
    name: "Node Exporter Essentials",
    description:
      "Host availability, CPU, memory, disk, and network health from Prometheus node_exporter metrics.",
    columns: 2,
    panels: [
      prometheusMetricPanel({
        id: "hosts-reporting",
        title: "Hosts Reporting",
        promql: "count(node_uname_info)",
        description: "Instances with node_uname_info",
      }),
      prometheusMetricPanel({
        id: "cpu-used",
        title: "CPU Used",
        promql: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
        description: "Average non-idle CPU over 5 minutes",
        yFormatter: "percent",
      }),
      prometheusMetricPanel({
        id: "memory-used",
        title: "Memory Used",
        promql:
          "1 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))",
        description: "Cluster memory utilization",
        yFormatter: "percent",
      }),
      prometheusMetricPanel({
        id: "disk-used",
        title: "Disk Used",
        promql:
          '1 - (sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}))',
        description: "Non-ephemeral filesystem utilization",
        yFormatter: "percent",
      }),
      prometheusSeriesPanel({
        id: "cpu-by-instance",
        title: "CPU Usage by Instance",
        promql:
          '1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))',
        description: "Non-idle CPU by instance",
        yFormatter: "percent",
      }),
      prometheusSeriesPanel({
        id: "memory-by-instance",
        title: "Memory Usage by Instance",
        promql:
          "1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
        description: "Memory utilization by instance",
        yFormatter: "percent",
      }),
      prometheusSeriesPanel({
        id: "network-receive",
        title: "Network Receive",
        promql:
          'sum by (instance) (rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]))',
        description: "Receive bytes per second by instance",
        chartType: "area",
      }),
    ],
  };
}

function buildNodeExporterFull(): SqlDashboardConfig {
  return seedConfig("node-exporter-full");
}

export const dashboardCatalogEntries: DashboardCatalogEntry[] = [
  {
    id: "first-party-template-traffic",
    name: "First-party Template Traffic",
    description:
      "Template clicks, demo starts, CLI copies, and first-party session activity.",
    category: "Product",
    defaultDashboardId: "agent-native-templates-first-party",
    dataSources: ["first-party"],
    tags: ["templates", "traffic", "sessions"],
    panelCount: 12,
    version: CATALOG_VERSION,
    recommended: true,
    buildConfig: () => seedConfig("agent-native-templates-first-party"),
  },
  {
    id: "google-analytics-web",
    name: "Google Analytics Website",
    description:
      "GA4 traffic, engagement, acquisition, top pages, and geography.",
    category: "Acquisition",
    defaultDashboardId: "google-analytics",
    dataSources: ["ga4"],
    tags: ["ga4", "website", "acquisition"],
    panelCount: 7,
    version: CATALOG_VERSION,
    buildConfig: () => seedConfig("google-analytics"),
  },
  {
    id: "node-exporter-essentials",
    name: "Node Exporter Essentials",
    description:
      "A compact Prometheus host health dashboard for the metrics most teams check first.",
    category: "Observability",
    defaultDashboardId: "node-exporter-essentials",
    dataSources: ["prometheus"],
    tags: ["prometheus", "node_exporter", "hosts"],
    panelCount: 7,
    version: CATALOG_VERSION,
    recommended: true,
    buildConfig: buildNodeExporterEssentials,
  },
  {
    id: "node-exporter-full",
    name: "Node Exporter Full",
    description:
      "The Linux-focused Grafana Node Exporter Full dashboard converted for Agent Native Analytics.",
    category: "Observability",
    defaultDashboardId: "node-exporter-full",
    dataSources: ["prometheus"],
    tags: ["prometheus", "node_exporter", "grafana", "capacity"],
    panelCount: 124,
    version: CATALOG_VERSION,
    buildConfig: buildNodeExporterFull,
  },
];

export function getDashboardCatalogEntry(
  id: string,
): DashboardCatalogEntry | null {
  return dashboardCatalogEntries.find((entry) => entry.id === id) ?? null;
}

export function cloneDashboardConfig(
  entry: DashboardCatalogEntry,
): SqlDashboardConfig {
  return JSON.parse(JSON.stringify(entry.buildConfig())) as SqlDashboardConfig;
}

function templateIdFromConfig(config: Record<string, unknown>): string | null {
  const catalog = config.catalog;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return null;
  }
  const templateId = (catalog as Record<string, unknown>).templateId;
  return typeof templateId === "string" && templateId ? templateId : null;
}

function installedDashboardForTemplate(
  row: DashboardRecord,
  entry: DashboardCatalogEntry,
): boolean {
  const templateId = templateIdFromConfig(row.config);
  return templateId === entry.id || row.id === entry.defaultDashboardId;
}

export async function listDashboardCatalog(
  ctx: AccessCtx,
): Promise<DashboardCatalogTemplate[]> {
  const dashboards = await listDashboards(ctx, {
    kind: "sql",
    archived: "all",
    hidden: "all",
  });

  return dashboardCatalogEntries.map((entry) => {
    const installedDashboards = dashboards
      .filter((row) => installedDashboardForTemplate(row, entry))
      .map((row) => ({
        id: row.id,
        name:
          typeof row.config.name === "string" && row.config.name.trim()
            ? row.config.name
            : row.title,
        visibility: row.visibility,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    const { buildConfig: _buildConfig, ...metadata } = entry;
    return {
      ...metadata,
      installedDashboards,
      installed: installedDashboards.length > 0,
    };
  });
}

export function applyCatalogMetadata(
  entry: DashboardCatalogEntry,
  config: SqlDashboardConfig,
): CatalogDashboardConfig {
  return {
    ...config,
    catalog: {
      templateId: entry.id,
      templateVersion: entry.version,
      installedAt: new Date().toISOString(),
    },
  };
}

export function generateDashboardId(entry: DashboardCatalogEntry): string {
  const suffix =
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 4);
  return `${entry.defaultDashboardId}-${suffix}`;
}
