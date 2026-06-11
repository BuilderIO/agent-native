import { z } from "zod";

const DemoDescriptorSchema = z.object({
  adapter: z.enum(["prometheus", "postgres", "events"]),
  dataset: z.enum(["node-exporter", "postgres-saas", "product-analytics"]),
  query: z.string().min(1),
  mode: z.enum(["instant", "range"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type DemoDescriptor = z.infer<typeof DemoDescriptorSchema>;

export interface DemoQueryResult {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}

const PROM_SCHEMA = [
  { name: "timestamp", type: "string" },
  { name: "series", type: "string" },
  { name: "value", type: "number" },
];

function inferSchema(rows: Record<string, unknown>[]) {
  const first = rows[0] ?? {};
  return Object.keys(first).map((name) => ({
    name,
    type:
      typeof first[name] === "number"
        ? "number"
        : typeof first[name] === "boolean"
          ? "boolean"
          : "string",
  }));
}

export function serializeDemoDescriptorInput(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  throw new Error("demo panel sql must be a JSON string or object");
}

export function parseDemoDescriptor(raw: string): DemoDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `demo panel sql must be a JSON object: ${err?.message ?? err}`,
    );
  }
  const result = DemoDescriptorSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; "),
    );
  }
  return result.data;
}

function rangePoints(now: Date, count = 24, stepMinutes = 15): string[] {
  const end = Math.floor(now.getTime() / 60_000) * 60_000;
  return Array.from({ length: count }, (_, i) => {
    const offset = (count - i - 1) * stepMinutes * 60_000;
    return new Date(end - offset).toISOString();
  });
}

function wave(i: number, base: number, amp: number, phase = 0): number {
  return (
    base +
    Math.sin(i / 2.8 + phase) * amp +
    Math.cos(i / 5 + phase) * amp * 0.35
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function promSeries(metric: string, labels: Record<string, string>): string {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  return `${metric}{${labelText}}`;
}

function requireDataset(d: DemoDescriptor, dataset: DemoDescriptor["dataset"]) {
  if (d.dataset !== dataset) {
    throw new Error(
      `demo query "${d.query}" requires dataset "${dataset}", got "${d.dataset}"`,
    );
  }
}

function runPrometheusDemo(d: DemoDescriptor, now: Date): DemoQueryResult {
  requireDataset(d, "node-exporter");
  const instance =
    typeof d.params?.instance === "string" ? d.params.instance : "demo-host-01";
  const job = typeof d.params?.job === "string" ? d.params.job : "node";
  const labels = { instance, job };
  const points = rangePoints(now);

  if (d.query === "node-up") {
    return {
      rows: [
        {
          timestamp: now.toISOString(),
          series: promSeries("up", labels),
          value: 1,
        },
      ],
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "cpu-busy-by-mode") {
    const modes = [
      ["user", 0.34, 0.07],
      ["system", 0.16, 0.04],
      ["iowait", 0.035, 0.015],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        modes.map(([mode, base, amp]) => ({
          timestamp,
          series: promSeries("node_cpu_seconds_total", {
            ...labels,
            mode,
            grafana_target: mode,
          }),
          value: round(clamp(wave(i, base, amp, mode.length), 0, 1), 4),
        })),
      ),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "load-average") {
    const loads = [
      ["1m", 1.7, 0.42],
      ["5m", 1.45, 0.25],
      ["15m", 1.25, 0.18],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        loads.map(([window, base, amp]) => ({
          timestamp,
          series: promSeries(`node_load${window.replace("m", "")}`, {
            ...labels,
            grafana_target: window,
          }),
          value: round(clamp(wave(i, base, amp, window.length), 0, 8), 3),
        })),
      ),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "memory-composition") {
    const series = [
      ["Active", 6.2, 0.6],
      ["Inactive", 2.1, 0.3],
      ["Wired", 3.4, 0.15],
      ["Compressed", 1.2, 0.22],
      ["Free", 3.1, 0.45],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        series.map(([name, base, amp]) => ({
          timestamp,
          series: promSeries("node_memory_bytes", {
            ...labels,
            grafana_target: name,
          }),
          value: round(clamp(wave(i, base, amp, name.length), 0, 32), 2),
        })),
      ),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "filesystem-usage") {
    const mounts = [
      ["/", 0.61],
      ["/var/lib/postgresql", 0.72],
      ["/backup", 0.48],
    ] as const;
    return {
      rows: mounts.map(([mountpoint, value]) => ({
        timestamp: now.toISOString(),
        series: promSeries("node_filesystem_used_ratio", {
          ...labels,
          mountpoint,
          fstype: "ext4",
        }),
        value,
      })),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "network-throughput") {
    const directions = [
      ["Receive MB/s", "node_network_receive_bytes_total", 24, 6],
      ["Transmit MB/s", "node_network_transmit_bytes_total", 16, 4],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        directions.map(([name, metric, base, amp]) => ({
          timestamp,
          series: promSeries(metric, {
            ...labels,
            device: "eth0",
            grafana_target: name,
          }),
          value: round(clamp(wave(i, base, amp, name.length), 0, 80), 2),
        })),
      ),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "disk-io") {
    const ops = [
      ["Read MB/s", "node_disk_read_bytes_total", 42, 12],
      ["Write MB/s", "node_disk_written_bytes_total", 31, 9],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        ops.map(([name, metric, base, amp]) => ({
          timestamp,
          series: promSeries(metric, {
            ...labels,
            device: "nvme0n1",
            grafana_target: name,
          }),
          value: round(clamp(wave(i, base, amp, name.length), 0, 120), 2),
        })),
      ),
      schema: PROM_SCHEMA,
    };
  }

  if (d.query === "collector-status") {
    const rows = [
      ["cpu", 1, 0.004],
      ["filesystem", 1, 0.009],
      ["netdev", 1, 0.007],
      ["diskstats", 1, 0.011],
      ["meminfo", 1, 0.003],
    ].map(([collector, success, duration]) => ({
      collector,
      success,
      durationSeconds: duration,
    }));
    return { rows, schema: inferSchema(rows) };
  }

  throw new Error(`Unknown node-exporter demo query: ${d.query}`);
}

function runPostgresDemo(d: DemoDescriptor, now: Date): DemoQueryResult {
  requireDataset(d, "postgres-saas");
  const points = rangePoints(now, 18, 20);

  if (d.query === "database-health") {
    const rows = [
      { metric: "Active connections", value: 118, status: "healthy" },
      { metric: "Cache hit rate", value: 0.992, status: "healthy" },
      { metric: "Transactions / sec", value: 1840, status: "healthy" },
      { metric: "Slow queries / min", value: 7, status: "watch" },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  if (d.query === "connections-by-state") {
    const states = [
      ["active", 82, 12],
      ["idle", 34, 8],
      ["idle in transaction", 4, 2],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        states.map(([state, base, amp]) => ({
          timestamp,
          state,
          connections: Math.round(
            clamp(wave(i, base, amp, state.length), 0, 180),
          ),
        })),
      ),
      schema: [
        { name: "timestamp", type: "string" },
        { name: "state", type: "string" },
        { name: "connections", type: "number" },
      ],
    };
  }

  if (d.query === "query-latency") {
    const percentiles = [
      ["p50", 28, 6],
      ["p95", 118, 24],
      ["p99", 260, 70],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        percentiles.map(([percentile, base, amp]) => ({
          timestamp,
          percentile,
          latencyMs: round(
            clamp(wave(i, base, amp, percentile.length), 1, 600),
          ),
        })),
      ),
      schema: [
        { name: "timestamp", type: "string" },
        { name: "percentile", type: "string" },
        { name: "latencyMs", type: "number" },
      ],
    };
  }

  if (d.query === "database-size") {
    const dbs = [
      ["app", 420, 5.4],
      ["events", 860, 9.2],
      ["warehouse", 1320, 14.5],
    ] as const;
    return {
      rows: points.flatMap((timestamp, i) =>
        dbs.map(([database, base, amp]) => ({
          timestamp,
          database,
          sizeGb: round(clamp(wave(i, base, amp, database.length), 0, 2200), 1),
        })),
      ),
      schema: [
        { name: "timestamp", type: "string" },
        { name: "database", type: "string" },
        { name: "sizeGb", type: "number" },
      ],
    };
  }

  if (d.query === "slow-queries") {
    const rows = [
      {
        query: "SELECT account_id, count(*) FROM events GROUP BY 1",
        calls: 2840,
        meanMs: 412,
        p95Ms: 1280,
      },
      {
        query: "UPDATE subscriptions SET synced_at = now() WHERE id = $1",
        calls: 1942,
        meanMs: 88,
        p95Ms: 310,
      },
      {
        query:
          "SELECT * FROM invoices WHERE customer_id = $1 ORDER BY created_at DESC",
        calls: 782,
        meanMs: 146,
        p95Ms: 520,
      },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  throw new Error(`Unknown postgres-saas demo query: ${d.query}`);
}

function dayRows(now: Date, count = 14): string[] {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (count - i - 1));
    return d.toISOString().slice(0, 10);
  });
}

function runEventsDemo(d: DemoDescriptor, now: Date): DemoQueryResult {
  requireDataset(d, "product-analytics");
  const days = dayRows(now);

  if (d.query === "kpi-summary") {
    const rows = [
      { metric: "Active users", value: 18420, delta: 0.084 },
      { metric: "Signup conversion", value: 0.147, delta: 0.018 },
      { metric: "Demo starts", value: 2310, delta: 0.112 },
      { metric: "Activated workspaces", value: 612, delta: 0.064 },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  if (d.query === "signups-by-day") {
    const rows = days.map((date, i) => ({
      date,
      signups: Math.round(clamp(wave(i, 320, 70, 1.5), 120, 520)),
      activated: Math.round(clamp(wave(i, 88, 22, 0.6), 30, 160)),
    }));
    return { rows, schema: inferSchema(rows) };
  }

  if (d.query === "sessions-by-channel") {
    const rows = [
      { channel: "Organic search", sessions: 12840 },
      { channel: "Direct", sessions: 9320 },
      { channel: "Community", sessions: 4180 },
      { channel: "Referrals", sessions: 3860 },
      { channel: "Paid", sessions: 2140 },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  if (d.query === "activation-funnel") {
    const rows = [
      { stage: "Visited", users: 42000 },
      { stage: "Started demo", users: 12300 },
      { stage: "Created workspace", users: 4100 },
      { stage: "Connected source", users: 1760 },
      { stage: "Saved dashboard", users: 980 },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  if (d.query === "top-events") {
    const rows = [
      { event: "dashboard_viewed", count: 48200, users: 12100 },
      { event: "agent_message_sent", count: 31840, users: 8420 },
      { event: "data_source_connected", count: 6240, users: 3120 },
      { event: "panel_created", count: 5100, users: 1940 },
      { event: "analysis_saved", count: 2180, users: 780 },
    ];
    return { rows, schema: inferSchema(rows) };
  }

  throw new Error(`Unknown product-analytics demo query: ${d.query}`);
}

export function runDemoPanelAt(raw: string, now: Date): DemoQueryResult {
  const d = parseDemoDescriptor(raw);
  if (d.adapter === "prometheus") return runPrometheusDemo(d, now);
  if (d.adapter === "postgres") return runPostgresDemo(d, now);
  return runEventsDemo(d, now);
}

export async function runDemoPanel(raw: string): Promise<DemoQueryResult> {
  return runDemoPanelAt(raw, new Date());
}
