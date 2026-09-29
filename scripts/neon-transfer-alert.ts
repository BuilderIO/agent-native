import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_BASE = "https://console.neon.tech/api/v2";
const ORG_ID = process.env.NEON_ORG_ID?.trim() || "org-empty-silence-22065240";
const API_KEY = process.env.NEON_API_KEY?.trim();
const SLACK_WEBHOOK = process.env.SLACK_NEON_TRANSFER_WEBHOOK_URL?.trim();
const GIGABYTE = 1_000_000_000;
const TERABYTE = 1_000_000_000_000;
const DAILY_THRESHOLD_BYTES = 50 * GIGABYTE;
const ABSOLUTE_THRESHOLD_BYTES = TERABYTE;
const API_MIN_INTERVAL_MS = 1_300;
const PROJECT_PAGE_SIZE = 400;
const PROJECT_LIST_TIMEOUT_MS = 25_000;
const LIVE_BACKTEST_DAYS = 28;
let lastApiRequestAt = 0;

export interface TransferPoint {
  projectId: string;
  projectName: string;
  date: string;
  bytes: number;
}

export interface TransferAlert extends TransferPoint {
  trailingMedianBytes: number | null;
  reasons: string[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function dateValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function hasCompleteTrailingWeek(
  points: readonly TransferPoint[],
  index: number,
): boolean {
  if (index < 7) return false;
  const point = points[index]!;
  return points
    .slice(index - 7, index)
    .every(
      (previous, offset) =>
        previous.date === utcDayOffset(point.date, offset - 7),
    );
}

export function findTransferAlerts(points: TransferPoint[]): TransferAlert[] {
  const byProject = new Map<string, TransferPoint[]>();
  for (const point of points) {
    const projectPoints = byProject.get(point.projectId) ?? [];
    projectPoints.push(point);
    byProject.set(point.projectId, projectPoints);
  }

  const alerts: TransferAlert[] = [];
  for (const projectPoints of byProject.values()) {
    const sorted = [...projectPoints].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (let index = 0; index < sorted.length; index++) {
      const point = sorted[index]!;
      const trailingMedianBytes = hasCompleteTrailingWeek(sorted, index)
        ? median(sorted.slice(index - 7, index).map(({ bytes }) => bytes))
        : null;
      const reasons: string[] = [];
      if (
        point.bytes > DAILY_THRESHOLD_BYTES &&
        trailingMedianBytes !== null &&
        point.bytes > 3 * trailingMedianBytes
      ) {
        reasons.push("over 3x the trailing 7-day median and over 50 GB");
      }
      if (point.bytes > ABSOLUTE_THRESHOLD_BYTES) {
        reasons.push("over 1 TB in one day");
      }
      if (reasons.length)
        alerts.push({ ...point, trailingMedianBytes, reasons });
    }
  }

  return alerts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.projectName.localeCompare(b.projectName),
  );
}

function metricBytes(record: Record<string, unknown>): number | undefined {
  const direct = numberValue(record.public_network_transfer_bytes);
  if (direct !== undefined) return direct;

  for (const collectionKey of ["consumption", "metrics", "values"]) {
    const collection = record[collectionKey];
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const metric = object(entry);
      if (!metric) continue;
      const name =
        metric.metric_name ?? metric.metric ?? metric.name ?? metric.type;
      if (name === "public_network_transfer_bytes") {
        const value = metric.value ?? metric.consumption_value ?? metric.amount;
        const parsed = numberValue(value);
        if (parsed !== undefined) return parsed;
      }
    }
  }
  return undefined;
}

export function extractConsumptionRows(
  payload: unknown,
  projectNames: ReadonlyMap<string, string>,
): TransferPoint[] {
  const root = object(payload);
  if (!root) throw new Error("Neon consumption response was not an object.");
  if (Array.isArray(root.unavailable) && root.unavailable.length > 0) {
    throw new Error(
      "Neon consumption response was incomplete; some projects are unavailable.",
    );
  }
  const rows = root.projects;
  if (!Array.isArray(rows))
    throw new Error("Neon consumption response did not contain project rows.");

  const totals = new Map<string, TransferPoint>();
  for (const item of rows) {
    const project = object(item);
    if (!project) continue;
    const projectId = project.project_id;
    if (typeof projectId !== "string" || !Array.isArray(project.periods)) {
      throw new Error(
        "Neon consumption response contained an invalid project row.",
      );
    }
    const projectName =
      projectNames.get(projectId) ??
      (typeof project.project_name === "string"
        ? project.project_name
        : projectId);
    for (const rawPeriod of project.periods) {
      const period = object(rawPeriod);
      if (!period || !Array.isArray(period.consumption)) {
        throw new Error(
          `Neon consumption response contained invalid periods for ${projectId}.`,
        );
      }
      for (const rawEntry of period.consumption) {
        const entry = object(rawEntry);
        if (!entry || !Array.isArray(entry.metrics)) {
          throw new Error(
            `Neon consumption response contained invalid daily metrics for ${projectId}.`,
          );
        }
        const date = dateValue(entry.timeframe_start);
        if (!date)
          throw new Error(
            `Neon consumption response contained an invalid date for ${projectId}.`,
          );
        const bytes = metricBytes(entry);
        if (bytes === undefined) continue;
        const key = `${projectId}:${date}`;
        const existing = totals.get(key);
        if (existing) {
          existing.bytes += bytes;
        } else {
          totals.set(key, { projectId, projectName, date, bytes });
        }
      }
    }
  }
  return [...totals.values()];
}

export function hasUnavailableProjects(
  payload: Record<string, unknown>,
): boolean {
  return [payload.unavailable_project_ids, payload.unavailable].some(
    (value) => Array.isArray(value) && value.length > 0,
  );
}

async function neonGet(url: URL): Promise<unknown> {
  if (!API_KEY) throw new Error("NEON_API_KEY is required for the live alert.");
  const waitMs = Math.max(
    0,
    API_MIN_INTERVAL_MS - (Date.now() - lastApiRequestAt),
  );
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastApiRequestAt = Date.now();
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Neon API returned HTTP ${response.status} for ${url.pathname}.`,
    );
  }
  return response.json();
}

async function listProjects(): Promise<Map<string, string>> {
  const projects = new Map<string, string>();
  let cursor: string | undefined;
  let page = 0;
  const seenCursors = new Set<string>();
  for (;;) {
    page += 1;
    const url = new URL(`${API_BASE}/projects`);
    url.searchParams.set("limit", String(PROJECT_PAGE_SIZE));
    url.searchParams.set("org_id", ORG_ID);
    url.searchParams.set("timeout", String(PROJECT_LIST_TIMEOUT_MS));
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = object(await neonGet(url));
    if (!payload || !Array.isArray(payload.projects)) {
      throw new Error("Neon project response did not contain a projects list.");
    }
    if (hasUnavailableProjects(payload))
      throw new Error(
        "Neon project list was incomplete; projects are unavailable.",
      );
    for (const rawProject of payload.projects) {
      const project = object(rawProject);
      if (typeof project?.id !== "string" || typeof project.name !== "string")
        throw new Error("Neon project list contained an invalid project row.");
      projects.set(project.id, project.name);
    }
    if (payload.projects.length < PROJECT_PAGE_SIZE) return projects;
    const pagination = object(payload.pagination);
    const nextCursor =
      typeof pagination?.cursor === "string" ? pagination.cursor : undefined;
    if (!nextCursor) return projects;
    if (seenCursors.has(nextCursor)) {
      throw new Error(
        `Neon project pagination repeated a cursor after page ${page}; ${projects.size} projects were read and the last page contained ${payload.projects.length}. Cursor matches request: ${nextCursor === cursor}.`,
      );
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function utcDayOffset(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function liveBacktestRange(now = new Date()): {
  from: string;
  to: string;
} {
  const to = utcDayOffset(now.toISOString().slice(0, 10), -1);
  return { from: utcDayOffset(to, 1 - LIVE_BACKTEST_DAYS), to };
}

async function fetchTransferPoints(
  projects: Map<string, string>,
  from: string,
  to: string,
): Promise<TransferPoint[]> {
  const points: TransferPoint[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const url = new URL(`${API_BASE}/consumption_history/v2/projects`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("org_id", ORG_ID);
    url.searchParams.set("metrics", "public_network_transfer_bytes");
    url.searchParams.set("granularity", "daily");
    url.searchParams.set("from", `${from}T00:00:00Z`);
    url.searchParams.set("to", `${to}T00:00:00Z`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = object(await neonGet(url));
    const parsed = extractConsumptionRows(payload, projects);
    for (const point of parsed) {
      points.push({
        ...point,
        projectName: projects.get(point.projectId) ?? point.projectName,
      });
    }
    const pagination = object(payload?.pagination);
    const nextCursor =
      typeof pagination?.cursor === "string" ? pagination.cursor : undefined;
    if (!nextCursor) return points;
    if (seenCursors.has(nextCursor)) {
      throw new Error("Neon consumption pagination repeated a cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function projectsMissingMedianBaseline(
  points: TransferPoint[],
  date: string,
): string[] {
  const byProject = new Map<string, TransferPoint[]>();
  for (const point of points) {
    const history = byProject.get(point.projectId) ?? [];
    history.push(point);
    byProject.set(point.projectId, history);
  }

  return [...byProject.values()]
    .map((history) => history.sort((a, b) => a.date.localeCompare(b.date)))
    .filter((history) => {
      const index = history.findIndex((point) => point.date === date);
      const today = history[index];
      return (
        today !== undefined &&
        today.bytes > DAILY_THRESHOLD_BYTES &&
        today.bytes <= ABSOLUTE_THRESHOLD_BYTES &&
        !hasCompleteTrailingWeek(history, index)
      );
    })
    .map((history) => history[0]!.projectName);
}

function formatGb(bytes: number | null): string {
  return bytes === null ? "n/a" : (bytes / GIGABYTE).toFixed(1);
}

export function formatAlertTable(alerts: TransferAlert[]): string {
  const header = "Date       Project              GB/day  Median7  Trigger";
  const rows = alerts.map(
    (alert) =>
      `${alert.date}  ${alert.projectName.padEnd(20).slice(0, 20)} ${formatGb(alert.bytes).padStart(6)}  ${formatGb(alert.trailingMedianBytes).padStart(7)}  ${alert.reasons.join("; ")}`,
  );
  return [header, ...rows].join("\n");
}

export async function publishDailyTransferAlerts(
  points: TransferPoint[],
  date: string,
  shouldSend: boolean,
  publish: (
    alerts: TransferAlert[],
    incompleteBaselines: string[],
  ) => Promise<void>,
): Promise<{ alerts: TransferAlert[]; incompleteBaselines: string[] }> {
  const alerts = findTransferAlerts(points).filter(
    (alert) => alert.date === date,
  );
  const incompleteBaselines = projectsMissingMedianBaseline(points, date);
  if (shouldSend && alerts.length > 0) {
    await publish(alerts, incompleteBaselines);
  }
  return { alerts, incompleteBaselines };
}

async function readBacktest(): Promise<TransferPoint[]> {
  const fixtureUrl = new URL(
    "./fixtures/neon-transfer-backtest-scenarios.json",
    import.meta.url,
  );
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
  const range = object(fixture);
  if (
    typeof range?.from !== "string" ||
    typeof range.to !== "string" ||
    !Array.isArray(range.projects)
  ) {
    throw new Error(
      "Backtest fixture did not contain a date range and project scenarios.",
    );
  }
  const points: TransferPoint[] = [];
  for (const rawProject of range.projects) {
    const project = object(rawProject);
    const overrides = object(project?.overrides);
    const defaultBytes = numberValue(project?.defaultBytes);
    if (
      typeof project?.projectId !== "string" ||
      typeof project.projectName !== "string" ||
      defaultBytes === undefined ||
      !overrides
    ) {
      throw new Error("Backtest fixture contains an invalid project scenario.");
    }
    for (
      let date = range.from;
      date <= range.to;
      date = utcDayOffset(date, 1)
    ) {
      const bytes = numberValue(overrides[date] ?? defaultBytes);
      if (bytes === undefined)
        throw new Error(
          `Backtest fixture contains an invalid value for ${date}.`,
        );
      points.push({
        projectId: project.projectId,
        projectName: project.projectName,
        date,
        bytes,
      });
    }
  }
  return points;
}

function parseArgs(args: string[]): {
  dryRun: boolean;
  send: boolean;
  backtest: boolean;
  liveBacktest: boolean;
} {
  const unknown = args.filter(
    (arg) =>
      !["--dry-run", "--send", "--backtest", "--backtest-live"].includes(arg),
  );
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const send = args.includes("--send");
  if (send && args.includes("--dry-run"))
    throw new Error("Choose either --send or --dry-run.");
  const backtest = args.includes("--backtest");
  const liveBacktest = args.includes("--backtest-live");
  if (send && (backtest || liveBacktest)) {
    throw new Error("Backtests never send Slack alerts.");
  }
  if (backtest && liveBacktest) {
    throw new Error("Choose either --backtest or --backtest-live.");
  }
  return { dryRun: !send, send, backtest, liveBacktest };
}

async function postSlack(
  alerts: TransferAlert[],
  incompleteBaselines: string[],
): Promise<void> {
  if (!SLACK_WEBHOOK)
    throw new Error(
      "SLACK_NEON_TRANSFER_WEBHOOK_URL is required to post live alerts.",
    );
  const warning = incompleteBaselines.length
    ? `\n\nMedian checks could not be completed for: ${incompleteBaselines.join(", ")}. Missing history was not treated as zero.`
    : "";
  const body = `Neon public network transfer alerts\n\n${formatAlertTable(alerts)}${warning}`;
  const response = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Slack webhook returned HTTP ${response.status}.`);
}

async function run(): Promise<void> {
  const { dryRun, send, backtest, liveBacktest } = parseArgs(
    process.argv.slice(2),
  );
  if (backtest) {
    const points = await readBacktest();
    const alerts = findTransferAlerts(points);
    console.log(
      "Offline scenario backtest from the supplied scaling spec; not a live Neon API sample.",
    );
    console.log(formatAlertTable(alerts));
    const expected = new Set([
      "docs:2026-09-03",
      "design:2026-09-08",
      "mail:2026-09-21",
    ]);
    const actual = new Set(
      alerts.map(
        ({ projectName, date }) => `${projectName.toLowerCase()}:${date}`,
      ),
    );
    for (const item of expected) {
      if (!actual.has(item))
        throw new Error(`Backtest did not flag required scenario ${item}.`);
    }
    return;
  }

  if (liveBacktest) {
    if (!API_KEY || !ORG_ID) {
      const missing = [
        !API_KEY ? "NEON_API_KEY" : undefined,
        !ORG_ID ? "NEON_ORG_ID" : undefined,
      ].filter((key): key is string => Boolean(key));
      console.error(
        `[neon-transfer-alert] could not run: ${missing.join(" and ")} required for the live backtest.`,
      );
      process.exitCode = 2;
      return;
    }
    const projects = await listProjects();
    if (projects.size === 0) throw new Error("Neon project list was empty.");
    const { from: backtestFrom, to: backtestTo } = liveBacktestRange();
    const from = utcDayOffset(backtestFrom, -7);
    const throughExclusive = utcDayOffset(backtestTo, 1);
    const points = await fetchTransferPoints(projects, from, throughExclusive);
    const alerts = findTransferAlerts(points).filter(
      ({ date }) => date >= backtestFrom && date <= backtestTo,
    );
    console.log(
      `Live Neon API backtest ${backtestFrom} through ${backtestTo}; fetched ${from} through ${utcDayOffset(throughExclusive, -1)} for trailing medians. This mode never posts to Slack.`,
    );
    console.log(formatAlertTable(alerts));
    if (backtestFrom > "2026-09-03" || backtestTo < "2026-09-24") {
      console.log(
        "September expected-alert checks skipped because those dates are outside the rolling backtest window.",
      );
      return;
    }
    const scenarios = [
      {
        label: "Docs on 2026-09-03",
        matches: alerts.some(
          ({ projectId, projectName, date }) =>
            (projectId === "nameless-heart-24943231" ||
              projectName.toLowerCase() === "docs") &&
            date === "2026-09-03",
        ),
      },
      {
        label: "Design around 2026-09-08",
        matches: alerts.some(
          ({ projectId, projectName, date }) =>
            (projectId === "lively-lake-47544625" ||
              projectName.toLowerCase() === "design") &&
            date >= "2026-09-07" &&
            date <= "2026-09-09",
        ),
      },
      {
        label: "Mail after 2026-09-19",
        matches: alerts.some(
          ({ projectId, projectName, date }) =>
            (projectId === "patient-cake-44789837" ||
              projectName.toLowerCase() === "mail") &&
            date > "2026-09-19",
        ),
      },
    ];
    for (const scenario of scenarios) {
      console.log(
        `Expected scenario ${scenario.label}: ${scenario.matches ? "flagged" : "not flagged"}`,
      );
    }
    const missingScenarios = scenarios
      .filter(({ matches }) => !matches)
      .map(({ label }) => label);
    if (missingScenarios.length) {
      throw new Error(
        `Live backtest did not flag expected scenarios: ${missingScenarios.join(", ")}.`,
      );
    }
    return;
  }

  if (!API_KEY || !ORG_ID) {
    const missing = [
      !API_KEY ? "NEON_API_KEY" : undefined,
      !ORG_ID ? "NEON_ORG_ID" : undefined,
    ].filter((key): key is string => Boolean(key));
    console.error(
      `[neon-transfer-alert] could not run: ${missing.join(" and ")} required.`,
    );
    process.exitCode = 2;
    return;
  }
  if (!dryRun && !SLACK_WEBHOOK) {
    console.error(
      "[neon-transfer-alert] could not run: SLACK_NEON_TRANSFER_WEBHOOK_URL is required to post live alerts.",
    );
    process.exitCode = 2;
    return;
  }

  const lastFullDay = utcDayOffset(new Date().toISOString().slice(0, 10), -1);
  const from = utcDayOffset(lastFullDay, -7);
  const throughExclusive = utcDayOffset(lastFullDay, 1);
  const projects = await listProjects();
  if (projects.size === 0) throw new Error("Neon project list was empty.");
  const fetched = await fetchTransferPoints(projects, from, throughExclusive);
  const { alerts, incompleteBaselines } = await publishDailyTransferAlerts(
    fetched,
    lastFullDay,
    !dryRun && send,
    postSlack,
  );

  console.log(
    `Neon public transfer for ${lastFullDay} (GB, trailing seven complete days):`,
  );
  console.log(formatAlertTable(alerts));
  if (incompleteBaselines.length > 0) {
    console.error(
      `[neon-transfer-alert] could not run the median check: ${incompleteBaselines.join(", ")} exceeded 50 GB but lacked seven consecutive returned daily measurements. Missing values were not treated as zero.`,
    );
    process.exitCode = 2;
  }
  if (!dryRun && send && alerts.length > 0) {
    console.log(`Posted ${alerts.length} Neon transfer alert(s) to Slack.`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
