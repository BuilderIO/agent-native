import {
  RadarQueryError,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  resolveRadarOrganizationId,
  getRadarBigQueryScanBudget,
  runBigQuery,
  setRadarBigQueryScanBudget,
} from "./query.ts";
import {
  buildBigQueryEventStatsSql,
  buildBigQueryUploadRejectionSql,
} from "./warehouse-sql.ts";
import {
  createEventChecks,
  loadUploadRejectionRows,
  uploadRejectionCheck,
} from "./watch.ts";

interface BacktestWindow {
  start: string;
  end: string;
}

interface Observation {
  check: string;
  app: string;
  period: string;
  status: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  detail: string | null;
}

export interface RadarBacktestResult {
  incident: BacktestWindow;
  clean: BacktestWindow;
  observations: Observation[];
  scanEstimateGb: number;
  maxTotalGb: number;
}

export interface RadarBacktestOptions {
  maxTotalGb?: number;
}

export const DEFAULT_BACKTEST_MAX_TOTAL_GB = 100;

const INCIDENT: BacktestWindow = {
  start: "2026-10-09",
  end: "2026-10-23",
};
const CLEAN: BacktestWindow = { start: "2026-10-02", end: "2026-10-08" };
const TRACKED_CHECKS = new Set([
  "builder-connect-success",
  "env-key-share",
  "ai-connection-none",
  "replay-upload-rejection",
]);
const DAILY_SUM_FIELDS = [
  "events",
  "users",
  "sessions",
  "new_user_run_events",
  "new_user_env_events",
  "new_user_source_events",
  "new_user_no_connection_events",
] as const;
const BACKTEST_EVENT_NAMES = [
  "signup",
  "builder_connect_succeeded",
  "builder connect succeeded",
  "builder_connect_failed",
  "builder connect failed",
  "generation_started",
  "design_prompt_submitted",
] as const;

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function dateOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "");
  const parsed = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : text.slice(0, 10);
}

export function backtestHourOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 13);
  const text = String(value ?? "").replace(" ", "T");
  return text.slice(0, 13);
}

export function parseRadarBacktestArgs(args: readonly string[]): {
  maxTotalGb: number;
} {
  let maxTotalGb = DEFAULT_BACKTEST_MAX_TOTAL_GB;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--max-total-gb") {
      throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
    }
    const value = Number(args[index + 1]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new RadarQueryError("--max-total-gb must be positive.", 2);
    }
    maxTotalGb = value;
    index += 1;
  }
  return { maxTotalGb };
}

function aggregateDailyRows(
  hourlyRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const aggregate = new Map<string, Record<string, unknown>>();
  for (const row of hourlyRows) {
    const date = dateOf(row.period_start);
    const app = String(row.app ?? "unknown");
    const eventName = String(row.event_name ?? "unknown");
    const key = `${date}|${app}|${eventName}`;
    const current = aggregate.get(key) ?? {
      period_start: date,
      app,
      event_name: eventName,
      ...Object.fromEntries(DAILY_SUM_FIELDS.map((field) => [field, 0])),
      signup_campaigns: [],
    };
    for (const field of DAILY_SUM_FIELDS) {
      current[field] = Number(current[field] ?? 0) + Number(row[field] ?? 0);
    }
    const campaigns = new Set([
      ...(Array.isArray(current.signup_campaigns)
        ? current.signup_campaigns.filter(
            (value): value is string => typeof value === "string",
          )
        : []),
      ...(Array.isArray(row.signup_campaigns)
        ? row.signup_campaigns.filter(
            (value): value is string => typeof value === "string",
          )
        : []),
    ]);
    current.signup_campaigns = [...campaigns];
    aggregate.set(key, current);
  }
  return [...aggregate.values()];
}

function datesBetween(window: BacktestWindow): string[] {
  const dates: string[] = [];
  for (let date = window.start; date <= window.end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function hourKeys(window: BacktestWindow): string[] {
  return datesBetween(window).flatMap((date) =>
    Array.from(
      { length: 24 },
      (_, hour) => `${date}T${String(hour).padStart(2, "0")}`,
    ),
  );
}

function observation(
  check: string,
  app: string,
  period: string,
  result: {
    status: string;
    numerator?: number | null;
    denominator?: number | null;
    value?: number | null;
    detail?: string;
  },
): Observation {
  return {
    check,
    app,
    period,
    status: result.status,
    numerator: result.numerator ?? null,
    denominator: result.denominator ?? null,
    value: result.value ?? null,
    detail: result.detail ?? null,
  };
}

export function hasBacktestAppCoverage(
  date: string,
  app: string,
  rejectionRows: readonly Record<string, unknown>[],
  dailyRows: readonly Record<string, unknown>[],
): boolean {
  return (
    rejectionRows.some((row) => String(row.app ?? "unknown") === app) ||
    dailyRows.some(
      (row) =>
        dateOf(row.period_start) === date &&
        String(row.app ?? "unknown") === app,
    )
  );
}

export async function runRadarBacktest(
  options: RadarBacktestOptions = {},
): Promise<RadarBacktestResult> {
  const maxTotalGb = options.maxTotalGb ?? DEFAULT_BACKTEST_MAX_TOTAL_GB;
  const backend = await resolveRadarFirstPartyBackend();
  if (backend.sink !== "bigquery") {
    throw new RadarQueryError(
      "The historical backtest requires the BigQuery first-party event sink.",
      2,
    );
  }
  const orgId = await resolveRadarOrganizationId();
  const table = await resolveRadarBigQueryEventsTable();
  const eventStart = addDays(CLEAN.start, -7);
  setRadarBigQueryScanBudget(maxTotalGb);
  try {
    const hourly = await runBigQuery(
      buildBigQueryEventStatsSql(table, "HOUR", BACKTEST_EVENT_NAMES),
      {
        maxGb: 100,
        fresh: true,
        cache: false,
        params: [
          { name: "start_date", type: "DATE", value: eventStart },
          { name: "end_date", type: "DATE", value: INCIDENT.end },
          { name: "org_id", type: "STRING", value: orgId },
        ],
      },
    );
    const hourlyRows = hourly.rows;
    const dailyRows = aggregateDailyRows(hourlyRows);
    const observations: Observation[] = [];

    for (const [label, window] of [
      ["clean", CLEAN],
      ["incident", INCIDENT],
    ] as const) {
      for (const hour of hourKeys(window)) {
        const targetDate = hour.slice(0, 10);
        const hourOfDay = hour.slice(11, 13);
        const baselineStart = addDays(targetDate, -7);
        const relevantHourlyRows = hourlyRows.filter((row) => {
          const period = backtestHourOf(row.period_start);
          const rowDate = dateOf(row.period_start);
          return (
            period.slice(11, 13) === hourOfDay &&
            rowDate >= baselineStart &&
            rowDate <= targetDate
          );
        });
        const checks = createEventChecks(
          relevantHourlyRows,
          [],
          [],
          [],
          [],
          hour.slice(0, 10),
          hour.slice(0, 10),
          hour,
          "hourly",
        ).checks;
        for (const check of checks) {
          if (check.id === "builder-connect-success") {
            observations.push(
              observation(check.id, check.app, `${label}:${hour}`, check),
            );
          }
        }
      }
      for (const date of datesBetween(window)) {
        const relevantDailyRows = dailyRows.filter(
          (row) => dateOf(row.period_start) === date,
        );
        const checks = createEventChecks(
          relevantDailyRows,
          [],
          [],
          [],
          [],
          date,
          date,
          `${date}T00`,
          "daily",
        ).checks;
        for (const check of checks) {
          if (
            (check.id === "env-key-share" ||
              check.id === "ai-connection-none") &&
            (check.id !== "ai-connection-none" || check.app === "slides")
          ) {
            observations.push(
              observation(check.id, check.app, `${label}:${date}`, check),
            );
          }
        }
      }
    }

    const rejectionResult = await runBigQuery(
      buildBigQueryUploadRejectionSql(table),
      {
        maxGb: 100,
        fresh: true,
        cache: false,
        params: [
          { name: "start_date", type: "DATE", value: CLEAN.start },
          { name: "end_date", type: "DATE", value: INCIDENT.end },
          { name: "org_id", type: "STRING", value: orgId },
        ],
      },
    );
    const rejectionRows = rejectionResult.rows;
    for (const window of [CLEAN, INCIDENT]) {
      for (const date of datesBetween(window)) {
        const rowsForDate = rejectionRows.filter(
          (row) => dateOf(row.event_date) === date,
        );
        const rows = rowsForDate.length
          ? await loadUploadRejectionRows(backend, date, orgId, rejectionRows)
          : [];
        const checkedApps = new Set<string>();
        for (const row of rows) {
          const check = uploadRejectionCheck(row);
          if (check) {
            checkedApps.add(check.app);
            const label = date >= INCIDENT.start ? "incident" : "clean";
            observations.push(
              observation(check.id, check.app, `${label}:${date}`, check),
            );
          }
        }
        for (const app of ["design", "slides", "clips"]) {
          if (checkedApps.has(app)) continue;
          const label = date >= INCIDENT.start ? "incident" : "clean";
          const hasAppCoverage = hasBacktestAppCoverage(
            date,
            app,
            rowsForDate,
            dailyRows,
          );
          observations.push({
            check: "replay-upload-rejection",
            app,
            period: `${label}:${date}`,
            status: hasAppCoverage ? "clear" : "insufficient",
            numerator: 0,
            denominator: null,
            value: null,
            detail: hasAppCoverage
              ? `No replay upload rejection events for ${app} on ${date}; other event data was available.`
              : `No event data was available to establish replay rejection coverage for ${app} on ${date}.`,
          });
        }
      }
    }

    const scanEstimateGb =
      (getRadarBigQueryScanBudget()?.reservedBytes ?? 0) / 1_000_000_000;
    return {
      incident: INCIDENT,
      clean: CLEAN,
      observations,
      scanEstimateGb,
      maxTotalGb,
    };
  } finally {
    setRadarBigQueryScanBudget(undefined);
  }
}

export function formatRadarBacktest(result: RadarBacktestResult): string {
  const lines = [
    "| Check | Window | App | Fired periods | Quiet periods | Unavailable periods | Insufficient periods | Evidence |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const check of TRACKED_CHECKS) {
    for (const window of ["clean", "incident"] as const) {
      const rows = result.observations.filter(
        (row) => row.check === check && row.period.startsWith(`${window}:`),
      );
      const periodRows = new Map<string, Observation>();
      const statusPriority: Record<string, number> = {
        clear: 1,
        observed: 1,
        insufficient: 2,
        unavailable: 3,
        fired: 4,
      };
      for (const row of rows) {
        const key = `${row.period}|${row.app}`;
        const current = periodRows.get(key);
        if (
          !current ||
          (statusPriority[row.status] ?? 0) >
            (statusPriority[current.status] ?? 0)
        ) {
          periodRows.set(key, row);
        }
      }
      const evaluated = [...periodRows.values()];
      const apps = [...new Set(evaluated.map((row) => row.app))].sort();
      const fired = evaluated.filter((row) => row.status === "fired");
      const unavailable = evaluated.filter(
        (row) => row.status === "unavailable",
      );
      const quiet = evaluated.filter(
        (row) => row.status === "clear" || row.status === "observed",
      );
      const insufficient = evaluated.filter(
        (row) => row.status === "insufficient",
      );
      const evidence = [...fired]
        .sort((left, right) => (right.numerator ?? 0) - (left.numerator ?? 0))
        .slice(0, 3)
        .map(
          (row) =>
            `${row.period.slice(window.length + 1)} ${row.app}: ${row.detail ?? `${row.numerator ?? 0}/${row.denominator ?? 0}`}`,
        )
        .join("; ");
      lines.push(
        `| ${check} | ${window} | ${apps.join(", ") || "-"} | ${fired.length} | ${quiet.length} | ${unavailable.length} | ${insufficient.length} | ${evidence || "-"} |`,
      );
    }
  }
  lines.push(
    "",
    `Incident: ${result.incident.start} through ${result.incident.end}; clean baseline: ${result.clean.start} through ${result.clean.end}.`,
    `BigQuery dry-run estimate: ${result.scanEstimateGb.toFixed(2)} GB / ${result.maxTotalGb} GB.`,
  );
  return lines.join("\n");
}

export function trackedRadarBacktestChecks(): string[] {
  return [...TRACKED_CHECKS];
}
