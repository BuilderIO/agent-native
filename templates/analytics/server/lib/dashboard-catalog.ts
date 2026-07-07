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
  dataSources: Array<"demo" | "first-party" | "ga4" | "prometheus">;
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
  visibleInCatalog?: boolean;
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

type PrometheusChartPanelOptions = {
  id: string;
  title: string;
  promql: string;
  tab: string;
  chartType?: "line" | "area" | "bar";
  width?: number;
  mode?: "instant" | "range";
  range?: string;
  step?: string;
  description?: string;
  yFormatter?: "number" | "percent";
  stacked?: boolean;
  legend?: boolean;
};

function prometheusChartPanel({
  id,
  title,
  promql,
  tab,
  chartType = "line",
  width = 3,
  mode,
  range = "{{range}}",
  step,
  description,
  yFormatter,
  stacked,
  legend,
}: PrometheusChartPanelOptions) {
  const resolvedMode = mode ?? (chartType === "bar" ? "instant" : "range");
  return {
    id,
    title,
    chartType,
    source: "prometheus" as const,
    width,
    tab,
    sql: promPanelSql(promql, {
      mode: resolvedMode,
      ...(resolvedMode === "range" ? { range } : {}),
      ...(step ? { step } : {}),
    }),
    config: {
      xKey: resolvedMode === "instant" ? "series" : "timestamp",
      yKey: "value",
      ...(resolvedMode === "range"
        ? {
            pivot: {
              xKey: "timestamp",
              seriesKey: "series",
              valueKey: "value",
            },
          }
        : {}),
      ...(description ? { description } : {}),
      ...(yFormatter ? { yFormatter } : {}),
      ...(stacked !== undefined ? { stacked } : {}),
      legend: legend ?? resolvedMode === "range",
    },
  };
}

function prometheusTablePanel({
  id,
  title,
  promql,
  tab,
  width = 6,
  description,
  limit = 100,
}: {
  id: string;
  title: string;
  promql: string;
  tab: string;
  width?: number;
  description?: string;
  limit?: number;
}) {
  return {
    id,
    title,
    chartType: "table" as const,
    source: "prometheus" as const,
    width,
    tab,
    sql: promPanelSql(promql, { mode: "instant" }),
    config: {
      description,
      limit,
      columns: [
        { key: "series", label: "Series" },
        { key: "value", label: "Value", format: "number" },
      ],
    },
  };
}

function buildNodeExporterFull(): SqlDashboardConfig {
  return seedConfig("node-exporter-full");
}

function buildDemoNodeExporterFull(): SqlDashboardConfig {
  const config = buildNodeExporterFull();
  return {
    ...config,
    name: "Demo Node Exporter Full",
    description:
      "The full Node Exporter dashboard wired to the built-in demo Prometheus endpoint.",
    panels: config.panels.map((panel) =>
      panel.source === "prometheus" ? { ...panel, source: "demo" } : panel,
    ),
  };
}

function buildNodeExporterMacos(): SqlDashboardConfig {
  const S = '{instance="{{instance}}",job="{{job}}"}';
  const selector = (extra = "") =>
    `{instance="{{instance}}",job="{{job}}"${extra ? `,${extra}` : ""}}`;
  const cores = `scalar(count(count(node_cpu_seconds_total${S}) by (cpu)))`;
  const physicalNet = 'device!~"lo0|gif0|stf0"';
  const apfs = 'fstype="apfs",device_error=""';

  const label = (expr: string, target: string) =>
    `label_replace((${expr}), "grafana_target", "${target}", "job", ".*")`;
  const labelMetric = (metric: string, target: string) =>
    `label_replace(${metric}${S}, "grafana_target", "${target}", "__name__", ".*")`;

  const panels: Array<Record<string, unknown>> = [];
  const section = (
    id: string,
    title: string,
    tab: string,
    description?: string,
    columns = 6,
  ) => {
    panels.push({
      id,
      title,
      chartType: "section",
      width: 1,
      columns,
      tab,
      ...(description ? { config: { description } } : {}),
    });
  };
  const metric = ({
    id,
    title,
    promql,
    tab,
    width = 1,
    yFormatter,
    description,
  }: {
    id: string;
    title: string;
    promql: string;
    tab: string;
    width?: number;
    yFormatter?: "number" | "percent";
    description?: string;
  }) => {
    panels.push(
      prometheusMetricPanel({
        id,
        title,
        promql,
        description: description ?? "",
        yFormatter,
      }),
    );
    const panel = panels[panels.length - 1];
    panel.tab = tab;
    panel.width = width;
  };
  const chart = (panel: PrometheusChartPanelOptions) => {
    panels.push(prometheusChartPanel(panel));
  };
  const table = (panel: Parameters<typeof prometheusTablePanel>[0]) => {
    panels.push(prometheusTablePanel(panel));
  };

  section(
    "overview-section",
    "macOS Host Overview",
    "Overview",
    "High-signal health checks from the Darwin node_exporter scrape.",
    4,
  );
  metric({
    id: "node-up",
    title: "Node Up",
    promql: `up${S}`,
    tab: "Overview",
    description: "Prometheus scrape target health.",
  });
  metric({
    id: "uptime-days",
    title: "Uptime (days)",
    promql: `(node_time_seconds${S} - node_boot_time_seconds${S}) / 86400`,
    tab: "Overview",
  });
  metric({
    id: "cpu-busy",
    title: "CPU Busy",
    promql: `1 - avg(rate(node_cpu_seconds_total${selector('mode="idle"')}[{{rateInterval}}]))`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "load-core",
    title: "Load / Core",
    promql: `node_load1${S} / ${cores}`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "memory-used",
    title: "Memory Used",
    promql: `1 - ((node_memory_free_bytes${S} + node_memory_inactive_bytes${S} + node_memory_purgeable_bytes${S}) / node_memory_total_bytes${S})`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "swap-used",
    title: "Swap Used",
    promql: `node_memory_swap_used_bytes${S} / clamp_min(node_memory_swap_total_bytes${S}, 1)`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "data-volume-used",
    title: "Data Volume Used",
    promql: `1 - node_filesystem_avail_bytes${selector('mountpoint="/System/Volumes/Data"')} / node_filesystem_size_bytes${selector('mountpoint="/System/Volumes/Data"')}`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "battery-charge",
    title: "Battery Charge",
    promql: `node_power_supply_current_capacity${S} / clamp_min(node_power_supply_max_capacity${S}, 1)`,
    tab: "Overview",
    yFormatter: "percent",
  });
  metric({
    id: "collector-failures",
    title: "Collector Failures",
    promql: `sum(1 - node_scrape_collector_success${S})`,
    tab: "Overview",
  });
  metric({
    id: "scrape-samples",
    title: "Scrape Samples",
    promql: `scrape_samples_scraped${S}`,
    tab: "Overview",
  });
  metric({
    id: "disk-read-mbps",
    title: "Disk Read MB/s",
    promql: `sum(rate(node_disk_read_bytes_total${S}[{{rateInterval}}])) / 1048576`,
    tab: "Overview",
  });
  metric({
    id: "network-rx-mbps",
    title: "Network RX MB/s",
    promql: `sum(rate(node_network_receive_bytes_total${selector(physicalNet)}[{{rateInterval}}])) / 1048576`,
    tab: "Overview",
  });

  section("cpu-section", "CPU and Load", "CPU");
  chart({
    id: "cpu-modes",
    title: "CPU Mode Breakdown",
    promql: `label_replace(avg by (mode) (rate(node_cpu_seconds_total${S}[{{rateInterval}}])), "grafana_target", "$1", "mode", "(.*)")`,
    tab: "CPU",
    chartType: "line",
    yFormatter: "percent",
  });
  chart({
    id: "cpu-core-busy",
    title: "CPU Busy by Core",
    promql: `1 - avg by (cpu) (rate(node_cpu_seconds_total${selector('mode="idle"')}[{{rateInterval}}]))`,
    tab: "CPU",
    yFormatter: "percent",
  });
  chart({
    id: "load-average",
    title: "Load Average",
    promql: `${labelMetric("node_load1", "1m")} or ${labelMetric("node_load5", "5m")} or ${labelMetric("node_load15", "15m")}`,
    tab: "CPU",
  });
  chart({
    id: "load-per-core",
    title: "Load per Core",
    promql: `${label(`node_load1${S} / ${cores}`, "1m/core")} or ${label(`node_load5${S} / ${cores}`, "5m/core")} or ${label(`node_load15${S} / ${cores}`, "15m/core")}`,
    tab: "CPU",
    yFormatter: "percent",
  });
  metric({
    id: "cpu-cores",
    title: "CPU Cores",
    promql: `count(count(node_cpu_seconds_total${S}) by (cpu))`,
    tab: "CPU",
  });

  section("memory-section", "Memory and Swap", "Memory");
  metric({
    id: "memory-total-gib",
    title: "Memory Total (GiB)",
    promql: `node_memory_total_bytes${S} / 1073741824`,
    tab: "Memory",
  });
  metric({
    id: "memory-used-gib",
    title: "Memory Used (GiB)",
    promql: `(node_memory_total_bytes${S} - node_memory_free_bytes${S} - node_memory_inactive_bytes${S} - node_memory_purgeable_bytes${S}) / 1073741824`,
    tab: "Memory",
  });
  metric({
    id: "memory-available-gib",
    title: "Available Approx. (GiB)",
    promql: `(node_memory_free_bytes${S} + node_memory_inactive_bytes${S} + node_memory_purgeable_bytes${S}) / 1073741824`,
    tab: "Memory",
  });
  metric({
    id: "memory-wired-gib",
    title: "Wired (GiB)",
    promql: `node_memory_wired_bytes${S} / 1073741824`,
    tab: "Memory",
  });
  metric({
    id: "memory-compressed-gib",
    title: "Compressed (GiB)",
    promql: `node_memory_compressed_bytes${S} / 1073741824`,
    tab: "Memory",
  });
  chart({
    id: "memory-composition",
    title: "Memory Composition",
    promql:
      `${label(`node_memory_active_bytes${S} / 1073741824`, "Active")} or ` +
      `${label(`node_memory_inactive_bytes${S} / 1073741824`, "Inactive")} or ` +
      `${label(`node_memory_wired_bytes${S} / 1073741824`, "Wired")} or ` +
      `${label(`node_memory_compressed_bytes${S} / 1073741824`, "Compressed")} or ` +
      `${label(`node_memory_internal_bytes${S} / 1073741824`, "Internal")} or ` +
      `${label(`node_memory_purgeable_bytes${S} / 1073741824`, "Purgeable")} or ` +
      `${label(`node_memory_free_bytes${S} / 1073741824`, "Free")}`,
    tab: "Memory",
    chartType: "area",
    width: 6,
    stacked: true,
  });
  chart({
    id: "memory-composition-now",
    title: "Memory Composition Now",
    promql:
      `${label(`node_memory_active_bytes${S} / 1073741824`, "Active")} or ` +
      `${label(`node_memory_inactive_bytes${S} / 1073741824`, "Inactive")} or ` +
      `${label(`node_memory_wired_bytes${S} / 1073741824`, "Wired")} or ` +
      `${label(`node_memory_compressed_bytes${S} / 1073741824`, "Compressed")} or ` +
      `${label(`node_memory_internal_bytes${S} / 1073741824`, "Internal")} or ` +
      `${label(`node_memory_purgeable_bytes${S} / 1073741824`, "Purgeable")} or ` +
      `${label(`node_memory_free_bytes${S} / 1073741824`, "Free")}`,
    tab: "Memory",
    chartType: "bar",
    width: 3,
  });
  chart({
    id: "swap-used-series",
    title: "Swap Used",
    promql: `node_memory_swap_used_bytes${S} / clamp_min(node_memory_swap_total_bytes${S}, 1)`,
    tab: "Memory",
    width: 3,
    yFormatter: "percent",
  });
  chart({
    id: "swap-io",
    title: "Swap IO",
    promql: `${label(`rate(node_memory_swapped_in_bytes_total${S}[{{rateInterval}}]) / 1048576`, "Swap in MB/s")} or ${label(`rate(node_memory_swapped_out_bytes_total${S}[{{rateInterval}}]) / 1048576`, "Swap out MB/s")}`,
    tab: "Memory",
    chartType: "area",
    width: 6,
  });

  section("storage-section", "APFS Storage", "Storage");
  metric({
    id: "data-total-gib",
    title: "Data Total (GiB)",
    promql: `node_filesystem_size_bytes${selector('mountpoint="/System/Volumes/Data"')} / 1073741824`,
    tab: "Storage",
  });
  metric({
    id: "data-avail-gib",
    title: "Data Available (GiB)",
    promql: `node_filesystem_avail_bytes${selector('mountpoint="/System/Volumes/Data"')} / 1073741824`,
    tab: "Storage",
  });
  metric({
    id: "data-purgeable-gib",
    title: "Data Purgeable (GiB)",
    promql: `node_filesystem_purgeable_bytes${selector('mountpoint="/System/Volumes/Data"')} / 1073741824`,
    tab: "Storage",
  });
  metric({
    id: "data-files-used",
    title: "Data File Nodes Used",
    promql: `1 - node_filesystem_files_free${selector('mountpoint="/System/Volumes/Data"')} / node_filesystem_files${selector('mountpoint="/System/Volumes/Data"')}`,
    tab: "Storage",
    yFormatter: "percent",
  });
  chart({
    id: "apfs-volume-used",
    title: "APFS Volume Used",
    promql: `1 - node_filesystem_avail_bytes${selector(apfs)} / node_filesystem_size_bytes${selector(apfs)}`,
    tab: "Storage",
    chartType: "bar",
    width: 3,
    yFormatter: "percent",
  });
  chart({
    id: "apfs-volume-avail",
    title: "APFS Available (GiB)",
    promql: `node_filesystem_avail_bytes${selector(apfs)} / 1073741824`,
    tab: "Storage",
    chartType: "bar",
    width: 3,
  });
  chart({
    id: "apfs-purgeable",
    title: "APFS Purgeable (GiB)",
    promql: `node_filesystem_purgeable_bytes${selector(apfs)} / 1073741824`,
    tab: "Storage",
    chartType: "bar",
    width: 3,
  });
  chart({
    id: "filesystem-files-used",
    title: "Filesystem File Nodes Used",
    promql: `1 - node_filesystem_files_free${selector(apfs)} / node_filesystem_files${selector(apfs)}`,
    tab: "Storage",
    chartType: "bar",
    width: 3,
    yFormatter: "percent",
  });
  table({
    id: "filesystem-status",
    title: "Filesystem Device Error / Readonly",
    promql: `node_filesystem_device_error${S} or node_filesystem_readonly${S}`,
    tab: "Storage",
    width: 3,
  });
  table({
    id: "mount-info",
    title: "Mount Info",
    promql: `node_filesystem_mount_info${S}`,
    tab: "Storage",
    width: 3,
  });

  section("disk-section", "Disk IO", "Disk");
  chart({
    id: "disk-throughput",
    title: "Disk Throughput",
    promql: `${label(`sum(rate(node_disk_read_bytes_total${S}[{{rateInterval}}])) / 1048576`, "Read MB/s")} or ${label(`sum(rate(node_disk_written_bytes_total${S}[{{rateInterval}}])) / 1048576`, "Write MB/s")}`,
    tab: "Disk",
    chartType: "area",
    width: 3,
  });
  metric({
    id: "disk-write-mbps",
    title: "Disk Write MB/s",
    promql: `sum(rate(node_disk_written_bytes_total${S}[{{rateInterval}}])) / 1048576`,
    tab: "Disk",
  });
  metric({
    id: "disk-read-iops",
    title: "Read IOPS",
    promql: `sum(rate(node_disk_reads_completed_total${S}[{{rateInterval}}]))`,
    tab: "Disk",
  });
  metric({
    id: "disk-write-iops",
    title: "Write IOPS",
    promql: `sum(rate(node_disk_writes_completed_total${S}[{{rateInterval}}]))`,
    tab: "Disk",
  });
  chart({
    id: "disk-iops",
    title: "Disk IOPS",
    promql: `${label(`sum(rate(node_disk_reads_completed_total${S}[{{rateInterval}}]))`, "Read IOPS")} or ${label(`sum(rate(node_disk_writes_completed_total${S}[{{rateInterval}}]))`, "Write IOPS")}`,
    tab: "Disk",
    width: 3,
  });
  chart({
    id: "disk-latency",
    title: "Disk Latency (ms/op)",
    promql: `${label(`1000 * sum(rate(node_disk_read_time_seconds_total${S}[{{rateInterval}}])) / clamp_min(sum(rate(node_disk_reads_completed_total${S}[{{rateInterval}}])), 0.000001)`, "Read ms/op")} or ${label(`1000 * sum(rate(node_disk_write_time_seconds_total${S}[{{rateInterval}}])) / clamp_min(sum(rate(node_disk_writes_completed_total${S}[{{rateInterval}}])), 0.000001)`, "Write ms/op")}`,
    tab: "Disk",
    width: 3,
  });
  chart({
    id: "disk-errors-retries",
    title: "Disk Errors and Retries",
    promql:
      `${label(`sum(rate(node_disk_read_errors_total${S}[{{rateInterval}}]))`, "Read errors/s")} or ` +
      `${label(`sum(rate(node_disk_write_errors_total${S}[{{rateInterval}}]))`, "Write errors/s")} or ` +
      `${label(`sum(rate(node_disk_read_retries_total${S}[{{rateInterval}}]))`, "Read retries/s")} or ` +
      `${label(`sum(rate(node_disk_write_retries_total${S}[{{rateInterval}}]))`, "Write retries/s")}`,
    tab: "Disk",
    width: 3,
  });
  table({
    id: "disk-counters",
    title: "Disk Counters",
    promql:
      `node_disk_read_bytes_total${S} or node_disk_written_bytes_total${S} or ` +
      `node_disk_reads_completed_total${S} or node_disk_writes_completed_total${S} or ` +
      `node_disk_read_sectors_total${S} or node_disk_written_sectors_total${S}`,
    tab: "Disk",
    width: 3,
  });

  section("network-section", "Network Interfaces", "Network");
  chart({
    id: "network-throughput",
    title: "Network Throughput",
    promql: `${label(`sum(rate(node_network_receive_bytes_total${selector(physicalNet)}[{{rateInterval}}])) / 1048576`, "Receive MB/s")} or ${label(`sum(rate(node_network_transmit_bytes_total${selector(physicalNet)}[{{rateInterval}}])) / 1048576`, "Transmit MB/s")}`,
    tab: "Network",
    chartType: "area",
    width: 5,
  });
  metric({
    id: "network-tx-mbps",
    title: "Network TX MB/s",
    promql: `sum(rate(node_network_transmit_bytes_total${selector(physicalNet)}[{{rateInterval}}])) / 1048576`,
    tab: "Network",
  });
  chart({
    id: "network-receive-devices",
    title: "Receive by Device",
    promql: `topk(8, rate(node_network_receive_bytes_total${selector(physicalNet)}[{{rateInterval}}]) / 1048576)`,
    tab: "Network",
    width: 3,
  });
  chart({
    id: "network-transmit-devices",
    title: "Transmit by Device",
    promql: `topk(8, rate(node_network_transmit_bytes_total${selector(physicalNet)}[{{rateInterval}}]) / 1048576)`,
    tab: "Network",
    width: 3,
  });
  chart({
    id: "network-packets",
    title: "Packets",
    promql: `${label(`sum(rate(node_network_receive_packets_total${selector(physicalNet)}[{{rateInterval}}]))`, "Receive packets/s")} or ${label(`sum(rate(node_network_transmit_packets_total${selector(physicalNet)}[{{rateInterval}}]))`, "Transmit packets/s")}`,
    tab: "Network",
    width: 3,
  });
  chart({
    id: "network-errors-drops",
    title: "Network Errors and Drops",
    promql: `${label(`sum(rate(node_network_receive_errs_total${S}[{{rateInterval}}]))`, "RX errors/s")} or ${label(`sum(rate(node_network_transmit_errs_total${S}[{{rateInterval}}]))`, "TX errors/s")} or ${label(`sum(rate(node_network_receive_drop_total${S}[{{rateInterval}}]))`, "RX drops/s")}`,
    tab: "Network",
    width: 3,
  });
  table({
    id: "network-detail",
    title: "Network Detail Counters",
    promql: `node_network_receive_multicast_total${S} or node_network_transmit_multicast_total${S} or node_network_transmit_colls_total${S} or node_network_noproto_total${S}`,
    tab: "Network",
  });

  section("power-section", "Battery and Power", "Power");
  metric({
    id: "charging",
    title: "Charging",
    promql: `node_power_supply_charging${S}`,
    tab: "Power",
  });
  metric({
    id: "battery-current-amps",
    title: "Battery Current (A)",
    promql: `node_power_supply_current_ampere${S}`,
    tab: "Power",
  });
  metric({
    id: "battery-time-full",
    title: "Hours to Full",
    promql: `node_power_supply_time_to_full_seconds${S} / 3600`,
    tab: "Power",
  });
  metric({
    id: "battery-time-empty",
    title: "Hours to Empty",
    promql: `node_power_supply_time_to_empty_seconds${S} / 3600`,
    tab: "Power",
  });
  chart({
    id: "battery-charge-series",
    title: "Battery Charge",
    promql: `node_power_supply_current_capacity${S} / clamp_min(node_power_supply_max_capacity${S}, 1)`,
    tab: "Power",
    yFormatter: "percent",
    width: 3,
  });
  chart({
    id: "battery-current-series",
    title: "Battery Current",
    promql: `node_power_supply_current_ampere${S}`,
    tab: "Power",
    width: 3,
  });
  chart({
    id: "battery-time-series",
    title: "Battery Time Estimate",
    promql: `${label(`node_power_supply_time_to_full_seconds${S} / 3600`, "Hours to full")} or ${label(`node_power_supply_time_to_empty_seconds${S} / 3600`, "Hours to empty")}`,
    tab: "Power",
    width: 6,
  });
  chart({
    id: "battery-health",
    title: "Battery Health State",
    promql: `node_power_supply_battery_health${S}`,
    tab: "Power",
    chartType: "bar",
    width: 3,
  });
  chart({
    id: "power-source",
    title: "Power Source State",
    promql: `node_power_supply_power_source_state${S}`,
    tab: "Power",
    chartType: "bar",
    width: 3,
  });

  section("exporter-section", "Exporter Runtime", "Exporter");
  metric({
    id: "process-cpu",
    title: "Exporter CPU %",
    promql: `rate(process_cpu_seconds_total${S}[{{rateInterval}}])`,
    tab: "Exporter",
    yFormatter: "percent",
  });
  metric({
    id: "process-rss",
    title: "Exporter RSS (MiB)",
    promql: `process_resident_memory_bytes${S} / 1048576`,
    tab: "Exporter",
  });
  metric({
    id: "open-fds",
    title: "Open FDs",
    promql: `process_open_fds${S} / clamp_min(process_max_fds${S}, 1)`,
    tab: "Exporter",
    yFormatter: "percent",
  });
  metric({
    id: "go-goroutines",
    title: "Go Goroutines",
    promql: `go_goroutines${S}`,
    tab: "Exporter",
  });
  metric({
    id: "go-heap",
    title: "Go Heap (MiB)",
    promql: `go_memstats_heap_alloc_bytes${S} / 1048576`,
    tab: "Exporter",
  });
  chart({
    id: "exporter-process-memory",
    title: "Exporter Process Memory",
    promql: `${label(`process_resident_memory_bytes${S} / 1048576`, "RSS MiB")} or ${label(`process_virtual_memory_bytes${S} / 1048576`, "Virtual MiB")}`,
    tab: "Exporter",
    width: 3,
  });
  chart({
    id: "go-heap-series",
    title: "Go Heap",
    promql: `${label(`go_memstats_heap_alloc_bytes${S} / 1048576`, "Heap alloc MiB")} or ${label(`go_memstats_heap_inuse_bytes${S} / 1048576`, "Heap in-use MiB")} or ${label(`go_memstats_heap_sys_bytes${S} / 1048576`, "Heap sys MiB")}`,
    tab: "Exporter",
    width: 3,
  });
  chart({
    id: "go-gc",
    title: "Go GC",
    promql: `${label(`rate(go_gc_duration_seconds_count${S}[{{rateInterval}}])`, "GC cycles/s")} or ${label(`rate(go_gc_duration_seconds_sum${S}[{{rateInterval}}])`, "GC pause seconds/s")}`,
    tab: "Exporter",
    width: 3,
  });
  chart({
    id: "collector-duration",
    title: "Collector Duration",
    promql: `node_scrape_collector_duration_seconds${S}`,
    tab: "Exporter",
    width: 3,
  });
  table({
    id: "collector-success",
    title: "Collector Success",
    promql: `node_scrape_collector_success${S}`,
    tab: "Exporter",
    width: 3,
  });
  chart({
    id: "promhttp-requests",
    title: "Metric Handler Requests",
    promql: `rate(promhttp_metric_handler_requests_total${S}[{{rateInterval}}])`,
    tab: "Exporter",
    width: 3,
  });
  table({
    id: "metric-family-coverage",
    title: "Metric Family Coverage",
    promql: `count by (__name__) ({job="{{job}}",instance="{{instance}}"})`,
    tab: "Exporter",
    description:
      "Every metric family scraped from this node target, including sample count.",
    limit: 150,
  });

  section("host-section", "Host Identity and Scrape", "Host");
  table({
    id: "system-info",
    title: "System and Exporter Info",
    promql: `node_uname_info${S} or node_os_info${S} or node_exporter_build_info${S}`,
    tab: "Host",
    description: "Darwin, OS, and node_exporter build labels.",
  });
  metric({
    id: "timezone-hours",
    title: "Time Zone Offset (hours)",
    promql: `node_time_zone_offset_seconds${S} / 3600`,
    tab: "Host",
  });
  metric({
    id: "time-drift",
    title: "Clock Drift (seconds)",
    promql: `abs(node_time_seconds${S} - time())`,
    tab: "Host",
  });
  chart({
    id: "target-up",
    title: "Scrape Target Up",
    promql: `up${S}`,
    tab: "Host",
    width: 3,
  });
  table({
    id: "collector-duration-current",
    title: "Collector Duration Current",
    promql: `node_scrape_collector_duration_seconds${S}`,
    tab: "Host",
    width: 3,
  });

  return {
    name: "Node Exporter macOS",
    description:
      "Darwin/macOS-specific Prometheus node_exporter dashboard covering CPU, load, memory, APFS filesystems, disk IO, network, battery, scrape health, and exporter runtime metrics.",
    columns: 6,
    filters: [
      {
        id: "range",
        type: "select",
        label: "Range",
        default: "6h",
        options: [
          { value: "15m", label: "Last 15 minutes" },
          { value: "1h", label: "Last 1 hour" },
          { value: "6h", label: "Last 6 hours" },
          { value: "24h", label: "Last 24 hours" },
          { value: "7d", label: "Last 7 days" },
        ],
      },
      {
        id: "job",
        type: "text",
        label: "Job",
        default: "node",
      },
      {
        id: "instance",
        type: "text",
        label: "Instance",
        default: "127.0.0.1:9100",
      },
    ],
    variables: {
      rateInterval: "5m",
    },
    panels: panels as unknown as SqlDashboardConfig["panels"],
  };
}

export const dashboardCatalogEntries: DashboardCatalogEntry[] = [
  {
    id: "demo-node-exporter",
    name: "Demo Node Exporter Full",
    description:
      "Explore CPU, memory, disk, network, filesystem, and load metrics using built-in sample Prometheus data, with no data source setup required.",
    category: "Observability",
    defaultDashboardId: "demo-node-exporter",
    dataSources: ["demo"],
    tags: ["demo", "prometheus", "node_exporter", "observability"],
    panelCount: 135,
    version: CATALOG_VERSION,
    recommended: true,
    buildConfig: buildDemoNodeExporterFull,
  },
  {
    id: "first-party-template-traffic",
    name: "First-party Template Traffic",
    description:
      "Template signups, clicks, demo starts, CLI copies, activity, top URLs, top clips, retention by template, and active users over time.",
    category: "Product",
    defaultDashboardId: "agent-native-templates-first-party",
    dataSources: ["first-party"],
    tags: [
      "templates",
      "traffic",
      "signups",
      "sessions",
      "retention",
      "active users",
      "pageviews",
      "urls",
      "clips",
      "referrals",
      "virality",
    ],
    panelCount: 34,
    version: CATALOG_VERSION,
    recommended: true,
    visibleInCatalog: false,
    buildConfig: () => seedConfig("agent-native-templates-first-party"),
  },
  {
    id: "agent-observability-llm",
    name: "Agent LLM Observability",
    description:
      "LLM generation volume, latency, errors, token usage, and cost captured as first-party `$ai_generation` tracking events.",
    category: "Observability",
    defaultDashboardId: "agent-observability-llm",
    dataSources: ["first-party"],
    tags: [
      "ai",
      "llm",
      "observability",
      "cost",
      "tokens",
      "latency",
      "posthog",
      "first-party",
    ],
    panelCount: 10,
    version: CATALOG_VERSION,
    recommended: true,
    buildConfig: () => seedConfig("agent-observability-llm"),
  },
  {
    id: "skills-cli-funnel",
    name: "Skills CLI Funnel",
    description:
      "Install funnel for the `npx @agent-native/skills@latest` and `npx @agent-native/core@latest skills` CLIs: starts, step-by-step dropoff, skill/client popularity, scope, and platform splits.",
    category: "Product",
    defaultDashboardId: "skills-cli-funnel",
    dataSources: ["first-party"],
    tags: ["skills", "cli", "funnel", "install", "first-party"],
    panelCount: 12,
    version: CATALOG_VERSION,
    recommended: true,
    visibleInCatalog: false,
    buildConfig: () => seedConfig("skills-cli-funnel"),
  },
  {
    id: "google-analytics-web",
    name: "Google Analytics Website",
    description:
      "Track GA4 website traffic, engagement, acquisition channels, top pages, geography, and browser/device mix.",
    category: "Acquisition",
    defaultDashboardId: "google-analytics",
    dataSources: ["ga4"],
    tags: ["ga4", "website", "acquisition"],
    panelCount: 7,
    version: CATALOG_VERSION,
    buildConfig: () => seedConfig("google-analytics"),
  },
  {
    id: "node-exporter-macos",
    name: "Node Exporter macOS",
    description:
      "Monitor macOS host CPU, memory, disk, filesystem, network, load, and Homebrew node_exporter health from Prometheus.",
    category: "Observability",
    defaultDashboardId: "node-exporter-macos",
    dataSources: ["prometheus"],
    tags: ["prometheus", "node_exporter", "macos", "darwin", "hosts"],
    panelCount: 77,
    version: CATALOG_VERSION,
    recommended: true,
    buildConfig: buildNodeExporterMacos,
  },
  {
    id: "node-exporter-full",
    name: "Node Exporter Full",
    description:
      "Monitor Linux host CPU, memory, disk, filesystem, network, and load, plus Prometheus demo-app traffic and latency panels.",
    category: "Observability",
    defaultDashboardId: "node-exporter-full",
    dataSources: ["prometheus"],
    tags: ["prometheus", "node_exporter", "grafana", "capacity"],
    panelCount: 135,
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

function demoIdFromConfig(config: Record<string, unknown>): string | null {
  const demo = config.demo;
  if (!demo || typeof demo !== "object" || Array.isArray(demo)) {
    return null;
  }
  const demoId = (demo as Record<string, unknown>).id;
  return typeof demoId === "string" && demoId ? demoId : null;
}

function installedDashboardForTemplate(
  row: DashboardRecord,
  entry: DashboardCatalogEntry,
): boolean {
  const templateId = templateIdFromConfig(row.config);
  const demoId = demoIdFromConfig(row.config);
  return (
    templateId === entry.id ||
    demoId === entry.id ||
    row.id === entry.defaultDashboardId
  );
}

export async function listDashboardCatalog(
  ctx: AccessCtx,
): Promise<DashboardCatalogTemplate[]> {
  const dashboards = await listDashboards(ctx, {
    kind: "sql",
    archived: "all",
    hidden: "all",
  });

  return dashboardCatalogEntries
    .filter((entry) => entry.visibleInCatalog !== false)
    .map((entry) => {
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

      const {
        buildConfig: _buildConfig,
        visibleInCatalog: _visibleInCatalog,
        ...metadata
      } = entry;
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
