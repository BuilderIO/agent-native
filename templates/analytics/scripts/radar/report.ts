import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAbReadout, formatAbMarkdown, type AbReadout } from "./ab.ts";
import {
  summarizeCampaignByActivityApp,
  type CampaignFollowupResult,
} from "./campaign.ts";
import type { RadarCheckResult } from "./checks.ts";
import { addLinkedEventMetricsSql } from "./linked-events-sql.ts";
import {
  RadarQueryError,
  RADAR_TMP_DIR,
  closeRadarQueries,
  ensureRadarPrivateDirectory,
  getRadarBigQueryScanBudget,
  radarRunCliExitCode,
  requiredRadarCliValue,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  resolveRadarOrganizationId,
  runBigQuery,
  setRadarBigQueryScanBudget,
} from "./query.ts";
import { runTriage, type TriageRun } from "./triage.ts";
import {
  buildBigQueryEventStatsSql,
  buildBigQueryFunnelDailySql,
  buildBigQueryPromptOutputSloByDateSql,
  buildBigQueryUploadRejectionSql,
} from "./warehouse-sql.ts";
import {
  matureFunnelCohortDate,
  runWatch,
  type RadarWatchPrefetchedQueries,
  type RadarWatchRun,
} from "./watch.ts";

interface DailyEntry {
  date: string;
  run?: RadarWatchRun;
  error?: string;
}

interface ReportIssue {
  key: string;
  id: string;
  app: string;
  detail: string;
  firedOn: string[];
}

export interface AcquisitionContextNote {
  effectiveAt: string;
  app: string;
  change: string;
}

export const DEFAULT_WEEKLY_MAX_TOTAL_GB = 100;

const ACQUISITION_CONTEXT: AcquisitionContextNote[] = [
  {
    effectiveAt: "2026-10-16",
    app: "slides",
    change: "Slides ads were off after this date.",
  },
  {
    effectiveAt: "2026-10-20 21:00 UTC",
    app: "clips, design",
    change: "Bing CPC ended around this time.",
  },
  {
    effectiveAt: "2026-10-21",
    app: "all paid",
    change: "Google paid spend was about 45% lower from this date.",
  },
];

export interface RadarWeeklyReport {
  generatedAt: string;
  week: string;
  weekEnd: string;
  coverage: {
    dailyRuns: { expected: number; completed: number; failedDates: string[] };
    campaignFollowup: boolean;
    abReadout: boolean;
    replayTriage: boolean;
    journeySnapshot: "completed" | "failed" | "not_present" | "skipped";
    weeklyPrefetch: {
      status: "complete" | "not_applicable" | "failed_fallback";
      completedQueries: number;
    };
    feedbackIngest: "agent_required";
    queryCount: number;
    bigQueryScan: {
      maxGb: number;
      reservedBytes: number;
      actualBytesProcessed: number;
      actualQueryCount: number;
      exceeded: boolean;
    };
  };
  dailyRuns: DailyEntry[];
  triageSummary: TriageRun["byAppOutcome"] | null;
  triageError: string | null;
  abReadout: AbReadout | null;
  campaignFollowup: CampaignFollowupResult | null;
  campaignAnnotations: RadarWatchRun["campaignAnnotations"];
  acquisitionContext: AcquisitionContextNote[];
  firedIssues: ReportIssue[];
  recovery: {
    available: boolean;
    items: Array<{
      key: string;
      state: "still_broken" | "recovered" | "unknown";
    }>;
  };
  journeySnapshot: {
    status: "completed" | "failed" | "not_present" | "skipped";
    summary?: string;
  };
  feedback: { status: "agent_required"; skill: "feedback-ingest" };
  exitCode: 0 | 1 | 2;
}

export function acquisitionContextForWeek(
  week: string,
  weekEnd: string,
): AcquisitionContextNote[] {
  const contextStart = addDays(week, -7);
  return ACQUISITION_CONTEXT.filter((note) => {
    const effectiveDate = note.effectiveAt.slice(0, 10);
    return effectiveDate >= contextStart && effectiveDate <= weekEnd;
  });
}

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function validMonday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

export function completedReportWeekEnd(
  week: string,
  latestCompleteDate = addDays(new Date().toISOString().slice(0, 10), -1),
): string {
  if (!validMonday(week))
    throw new RadarQueryError("--week must be a Monday in YYYY-MM-DD form.", 2);
  const weekEnd = addDays(week, 6);
  if (weekEnd > latestCompleteDate) {
    throw new RadarQueryError(
      "--week must end before today's UTC date; partial and future weeks are unavailable.",
      2,
    );
  }
  return weekEnd;
}

export async function captureWeeklyPrefetchResult<T>(
  prefetch: () => Promise<T>,
): Promise<{ value: T | undefined; failed: boolean }> {
  try {
    return { value: await prefetch(), failed: false };
  } catch {
    return { value: undefined, failed: true };
  }
}

function issueKey(check: RadarCheckResult): string {
  let specific = check.id;
  if (check.id === "event-first-seen-or-zero")
    specific = `${specific}:${check.detail?.split(" ")[0] ?? "event"}`;
  if (check.id === "session-trouble-pair")
    specific = `${specific}:${check.detail?.split(" affected ")[0] ?? "pair"}`;
  if (check.id === "replay-upload-rejection")
    specific = `${specific}:${check.detail?.match(/\(([^)]+)\)/)?.[1] ?? "upload"}`;
  return `${specific}|${check.app}`;
}

function compactCheck(check: RadarCheckResult): ReportIssue {
  return {
    key: issueKey(check),
    id: check.id,
    app: check.app,
    detail: check.detail ?? check.message,
    firedOn: [],
  };
}

export function recoveryStateForIssue(
  checks: readonly RadarCheckResult[] | undefined,
  key: string,
): "still_broken" | "recovered" | "unknown" {
  if (!checks) return "unknown";
  const check = checks.find((item) => issueKey(item) === key);
  if (!check) return "unknown";
  if (check.status === "fired") return "still_broken";
  if (check.status === "clear" || check.status === "observed")
    return "recovered";
  return "unknown";
}

function readPreviousIssues(week: string): ReportIssue[] | null {
  const previousWeek = addDays(week, -7);
  const file = path.join(RADAR_TMP_DIR, "runs", previousWeek, "radar.json");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw new RadarQueryError(
      "Previous weekly radar report could not be read.",
      2,
    );
  }
  let payload: { firedIssues?: ReportIssue[] };
  try {
    payload = JSON.parse(contents) as { firedIssues?: ReportIssue[] };
  } catch {
    throw new RadarQueryError("Previous weekly radar report is malformed.", 2);
  }
  if (!Array.isArray(payload.firedIssues))
    throw new RadarQueryError(
      "Previous weekly radar report has no issue list.",
      2,
    );
  return payload.firedIssues;
}

function runJourneySnapshot(
  week: string,
): RadarWeeklyReport["journeySnapshot"] {
  const packageFile = path.join(
    RADAR_TMP_DIR,
    "..",
    "..",
    "templates",
    "analytics",
    "package.json",
  );
  const fallback = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../package.json",
  );
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(
      fs.readFileSync(
        fs.existsSync(packageFile) ? packageFile : fallback,
        "utf8",
      ),
    ) as { scripts?: Record<string, string> };
  } catch {
    return {
      status: "failed",
      summary: "Analytics package scripts could not be read.",
    };
  }
  if (!packageJson.scripts?.["journey:snapshot"])
    return { status: "not_present" };
  try {
    execFileSync(
      "pnpm",
      ["--filter", "analytics", "journey:snapshot", "--week", week],
      {
        cwd: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../..",
          "..",
        ),
        encoding: "utf8",
        timeout: 180_000,
        stdio: "ignore",
      },
    );
    return { status: "completed", summary: "journey:snapshot completed." };
  } catch {
    return {
      status: "failed",
      summary: "journey:snapshot exited unsuccessfully.",
    };
  }
}

export interface WeeklyReportOptions {
  skipJourneySnapshot?: boolean;
  maxTotalGb?: number;
  freshBigQuery?: boolean;
}

export function parseReportArgs(args: readonly string[]): {
  week: string | undefined;
  skipJourneySnapshot: boolean;
  maxTotalGb: number;
  freshBigQuery: boolean;
} {
  let week: string | undefined;
  let skipJourneySnapshot = false;
  let maxTotalGb = DEFAULT_WEEKLY_MAX_TOTAL_GB;
  let freshBigQuery = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--week") {
      week = requiredRadarCliValue(args, index, "--week");
      index += 1;
    } else if (args[index] === "--skip-journey-snapshot")
      skipJourneySnapshot = true;
    else if (args[index] === "--fresh-bigquery") freshBigQuery = true;
    else if (args[index] === "--max-total-gb") {
      const value = Number(
        requiredRadarCliValue(args, index, "--max-total-gb"),
      );
      if (!Number.isFinite(value) || value <= 0) {
        throw new RadarQueryError("--max-total-gb must be positive.", 2);
      }
      maxTotalGb = value;
      index += 1;
    } else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  return { week, skipJourneySnapshot, maxTotalGb, freshBigQuery };
}

function privateDirectory(directory: string): void {
  ensureRadarPrivateDirectory(directory);
}

function writePrivate(file: string, content: string): void {
  privateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  const existing = fs.existsSync(file) ? fs.lstatSync(file) : undefined;
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    fs.unlinkSync(temporary);
    throw new RadarQueryError("Radar report target is not a regular file.", 2);
  }
  fs.renameSync(temporary, file);
}

export async function buildWeeklyReport(
  week: string,
  options: WeeklyReportOptions = {},
): Promise<RadarWeeklyReport> {
  const maxTotalGb = options.maxTotalGb ?? DEFAULT_WEEKLY_MAX_TOTAL_GB;
  setRadarBigQueryScanBudget(maxTotalGb);
  try {
    return await buildWeeklyReportWithinBudget(week, options, maxTotalGb);
  } finally {
    setRadarBigQueryScanBudget(undefined);
  }
}

async function buildWeeklyReportWithinBudget(
  week: string,
  options: WeeklyReportOptions,
  maxTotalGb: number,
): Promise<RadarWeeklyReport> {
  const weekEnd = completedReportWeekEnd(week);
  const cutoff = new Date();
  const queriesBeforePrefetch =
    getRadarBigQueryScanBudget()?.actualQueryCount ?? 0;
  const prefetchResult = await captureWeeklyPrefetchResult(() =>
    prefetchWeeklyBigQuery(
      week,
      weekEnd,
      cutoff,
      maxTotalGb,
      options.freshBigQuery ?? false,
    ),
  );
  const prefetched = prefetchResult.value;
  const completedPrefetchQueries = Math.max(
    0,
    (getRadarBigQueryScanBudget()?.actualQueryCount ?? queriesBeforePrefetch) -
      queriesBeforePrefetch,
  );
  const weeklyPrefetch = {
    status: prefetchResult.failed
      ? ("failed_fallback" as const)
      : prefetched
        ? ("complete" as const)
        : ("not_applicable" as const),
    completedQueries: completedPrefetchQueries,
  };
  const dailyRuns: DailyEntry[] = [];
  let queryCount = completedPrefetchQueries;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(week, offset);
    try {
      const run = await runWatch({
        date,
        window: "daily",
        includeCampaign: offset === 6,
        freshBigQuery: options.freshBigQuery ?? false,
        cutoff,
        ...(prefetched ? { prefetched } : {}),
      });
      dailyRuns.push({ date, run });
      queryCount += run.queryCount;
    } catch (error) {
      dailyRuns.push({
        date,
        error:
          error instanceof Error ? error.message : "Daily watch could not run.",
      });
    }
  }
  let triage: TriageRun | null = null;
  let triageError: string | null = null;
  try {
    triage = await runTriage({ date: weekEnd });
    queryCount += 2;
  } catch (error) {
    triage = null;
    triageError =
      error instanceof RadarQueryError
        ? error.message
        : "Replay triage could not run.";
  }

  let abReadout: AbReadout | null = null;
  try {
    abReadout = await runAbReadout({ startDate: week, endDate: weekEnd });
    queryCount += 2;
  } catch {
    abReadout = null;
  }

  const journeySnapshot = options.skipJourneySnapshot
    ? {
        status: "skipped" as const,
        summary: "Skipped by --skip-journey-snapshot.",
      }
    : runJourneySnapshot(week);
  if (
    journeySnapshot.status !== "not_present" &&
    journeySnapshot.status !== "skipped"
  )
    queryCount += 1;
  const campaignFollowup =
    [...dailyRuns].reverse().find((entry) => entry.run?.campaignFollowup)?.run
      ?.campaignFollowup ?? null;
  const campaignAnnotations =
    [...dailyRuns].reverse().find((entry) => entry.run?.campaignAnnotations)
      ?.run?.campaignAnnotations ?? [];
  const firedByKey = new Map<string, ReportIssue>();
  for (const entry of dailyRuns) {
    for (const check of entry.run?.checks.filter(
      (item) => item.status === "fired",
    ) ?? []) {
      const key = issueKey(check);
      const existing = firedByKey.get(key) ?? compactCheck(check);
      if (!existing.firedOn.includes(entry.date))
        existing.firedOn.push(entry.date);
      existing.detail = check.detail ?? check.message;
      firedByKey.set(key, existing);
    }
  }
  const firedIssues = [...firedByKey.values()];
  const prior = readPreviousIssues(week);
  const lastDayChecks = dailyRuns[dailyRuns.length - 1]?.run?.checks;
  const recoveryItems = (prior ?? []).map((issue) => {
    return {
      key: issue.key,
      state: recoveryStateForIssue(lastDayChecks, issue.key),
    };
  });
  const failedDates = dailyRuns
    .filter((entry) => !entry.run)
    .map((entry) => entry.date);
  const needsAttention = dailyRuns.some((entry) => entry.run?.exitCode === 1);
  const exitCode: 0 | 1 | 2 =
    failedDates.length ||
    journeySnapshot.status === "failed" ||
    journeySnapshot.status === "skipped" ||
    !triage ||
    !abReadout
      ? 2
      : needsAttention
        ? 1
        : 0;
  const bigQueryScanBudget = getRadarBigQueryScanBudget();
  if (!bigQueryScanBudget) {
    throw new RadarQueryError("Weekly BigQuery scan budget is unavailable.", 2);
  }
  return {
    generatedAt: new Date().toISOString(),
    week,
    weekEnd,
    coverage: {
      dailyRuns: {
        expected: 7,
        completed: 7 - failedDates.length,
        failedDates,
      },
      campaignFollowup: campaignFollowup !== null,
      abReadout: abReadout !== null,
      replayTriage: triage !== null,
      journeySnapshot: journeySnapshot.status,
      weeklyPrefetch,
      feedbackIngest: "agent_required",
      queryCount,
      bigQueryScan: {
        maxGb: bigQueryScanBudget.maxGb,
        reservedBytes: bigQueryScanBudget.reservedBytes,
        actualBytesProcessed: bigQueryScanBudget.actualBytesProcessed,
        actualQueryCount: bigQueryScanBudget.actualQueryCount,
        exceeded: bigQueryScanBudget.exceeded,
      },
    },
    dailyRuns,
    triageSummary: triage?.byAppOutcome ?? null,
    triageError,
    abReadout,
    campaignFollowup,
    campaignAnnotations,
    acquisitionContext: acquisitionContextForWeek(week, weekEnd),
    firedIssues,
    recovery: {
      available: prior !== null && lastDayChecks !== undefined,
      items: recoveryItems,
    },
    journeySnapshot,
    feedback: { status: "agent_required", skill: "feedback-ingest" },
    exitCode,
  };
}

async function prefetchWeeklyBigQuery(
  week: string,
  weekEnd: string,
  cutoff: Date,
  maxGb: number,
  fresh: boolean,
): Promise<RadarWatchPrefetchedQueries | undefined> {
  const backend = await resolveRadarFirstPartyBackend();
  if (backend.sink !== "bigquery") return undefined;

  const orgId = await resolveRadarOrganizationId();
  const table = await resolveRadarBigQueryEventsTable();
  const eventStart = addDays(week, -30);
  const eventSql = addLinkedEventMetricsSql(
    buildBigQueryEventStatsSql(table, "DAY"),
    "bigquery",
    "DAY",
  );
  const eventRows = await runBigQuery(eventSql, {
    maxGb,
    fresh,
    ...(fresh ? { cache: false } : {}),
    params: [
      { name: "start_date", type: "DATE", value: eventStart },
      { name: "end_date", type: "DATE", value: weekEnd },
      { name: "org_id", type: "STRING", value: orgId },
    ],
  });

  const firstCohort = matureFunnelCohortDate(week, cutoff);
  const lastCohort = matureFunnelCohortDate(weekEnd, cutoff);
  const funnelRows = await runBigQuery(buildBigQueryFunnelDailySql(table), {
    maxGb,
    fresh,
    ...(fresh ? { cache: false } : {}),
    params: [
      { name: "start_date", type: "DATE", value: addDays(firstCohort, -8) },
      { name: "end_date", type: "DATE", value: addDays(lastCohort, 1) },
      { name: "org_id", type: "STRING", value: orgId },
      { name: "cutoff", type: "TIMESTAMP", value: cutoff.toISOString() },
    ],
  });

  const sloRows = await runBigQuery(
    buildBigQueryPromptOutputSloByDateSql(table),
    {
      maxGb,
      fresh,
      ...(fresh ? { cache: false } : {}),
      params: [
        { name: "source_start_date", type: "DATE", value: addDays(week, -6) },
        { name: "source_end_date", type: "DATE", value: weekEnd },
        { name: "target_start_date", type: "DATE", value: week },
        { name: "target_end_date", type: "DATE", value: weekEnd },
        { name: "org_id", type: "STRING", value: orgId },
      ],
    },
  );

  const uploadRows = await runBigQuery(buildBigQueryUploadRejectionSql(table), {
    maxGb,
    fresh: true,
    cache: false,
    params: [
      { name: "start_date", type: "DATE", value: week },
      { name: "end_date", type: "DATE", value: weekEnd },
      { name: "org_id", type: "STRING", value: orgId },
    ],
  });

  return {
    eventRows: eventRows.rows,
    funnelRows: funnelRows.rows,
    sloRows: sloRows.rows,
    uploadRows: uploadRows.rows,
  };
}

export function formatWeeklyMarkdown(report: RadarWeeklyReport): string {
  const bigQueryScanGb =
    report.coverage.bigQueryScan.reservedBytes / 1_000_000_000;
  const actualBigQueryScanGb =
    report.coverage.bigQueryScan.actualBytesProcessed / 1_000_000_000;
  const lines = [
    `# First-touch radar report: ${report.week} to ${report.weekEnd}`,
    "",
    `Exit ${report.exitCode}. Daily runs ${report.coverage.dailyRuns.completed}/${report.coverage.dailyRuns.expected}. Query count ${report.coverage.queryCount}.`,
    `Coverage: campaign ${report.coverage.campaignFollowup ? "ready" : "missing"}; A/B ${report.coverage.abReadout ? "ready" : "missing"}; triage ${report.coverage.replayTriage ? "ready" : "missing"}; journey snapshot ${report.coverage.journeySnapshot}; Slack feedback ${report.coverage.feedbackIngest}.`,
    `Weekly prefetch: ${report.coverage.weeklyPrefetch.status}; ${report.coverage.weeklyPrefetch.completedQueries}/4 queries completed before any daily fallback.`,
    `BigQuery actual bytes processed: ${actualBigQueryScanGb.toFixed(2)} GB across ${report.coverage.bigQueryScan.actualQueryCount} executed queries. Dry-run estimate: ${bigQueryScanGb.toFixed(2)} GB / ${report.coverage.bigQueryScan.maxGb} GB${report.coverage.bigQueryScan.exceeded ? " (budget reached)" : ""}.`,
    "",
    "## Daily watch",
    "",
    "| Watch date | Funnel cohort | Exit | Fired | Unavailable | Error |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const entry of report.dailyRuns) {
    if (!entry.run)
      lines.push(
        `| ${entry.date} | unavailable | 2 | n/a | n/a | ${entry.error ?? "could not run"} |`,
      );
    else
      lines.push(
        `| ${entry.date} | ${entry.run.coverage.funnelCohortDate ?? "not run"} | ${entry.run.exitCode} | ${entry.run.checks.filter((check) => check.status === "fired").length} | ${entry.run.checks.filter((check) => check.status === "unavailable").length} | - |`,
      );
  }
  lines.push("", "## First-touch journeys", "");
  for (const entry of report.dailyRuns) {
    if (!entry.run) {
      lines.push(
        `- ${entry.date}: journey data unavailable (${entry.error ?? "daily watch failed"}).`,
      );
      continue;
    }
    const rows = entry.run.journeyRows;
    const designWeb = rows.find((row) => row.journey_type === "design_web");
    const designMcp = rows.find((row) => row.journey_type === "design_mcp");
    const clips = rows.find(
      (row) => row.journey_type === "first_touch" && row.app === "clips",
    );
    lines.push(
      `- ${entry.date} Design web signup → onboarding → app entry → prompt → ready: ${Number(designWeb?.signups ?? 0)} → ${Number(designWeb?.completed ?? 0)} → ${Number(designWeb?.entered ?? 0)} → ${Number(designWeb?.prompted ?? 0)} → ${Number(designWeb?.output ?? 0)}.`,
      `- ${entry.date} Design MCP signup → agent connected → first $mcp_tool_call → design created: ${Number(designMcp?.signups ?? 0)} → ${Number(designMcp?.completed ?? 0)} → ${Number(designMcp?.entered ?? 0)} → ${Number(designMcp?.output ?? 0)}.`,
      `- ${entry.date} Clips signup → recording_ready within 24h: ${Number(clips?.signups ?? 0)} → ${Number(clips?.clips_activated_24h ?? 0)}.`,
    );
  }
  lines.push(
    "",
    "Clips activation uses signup → recording_ready within 24 hours. The 2026-10-21 event-definition break removed local-only recordings; recording_started counts before that date are not comparable.",
  );
  lines.push("", "## Paid acquisition context", "");
  if (report.acquisitionContext.length) {
    lines.push("Known changes supplied with the radar research:");
    for (const note of report.acquisitionContext)
      lines.push(`- ${note.effectiveAt} (${note.app}): ${note.change}`);
  } else
    lines.push(
      "No known paid-acquisition changes in the report window or prior-week baseline.",
    );
  lines.push("", "## Top fired checks", "");
  if (!report.firedIssues.length)
    lines.push("No checks fired during the week.");
  else {
    for (const issue of [...report.firedIssues]
      .sort((a, b) => b.firedOn.length - a.firedOn.length)
      .slice(0, 3)) {
      lines.push(
        `- ${issue.id} (${issue.app}) on ${issue.firedOn.join(", ")}: ${issue.detail}`,
      );
    }
  }
  lines.push("", "## Previous report recovery", "");
  if (!report.recovery.available)
    lines.push("No previous report was available for recovery comparison.");
  else if (!report.recovery.items.length)
    lines.push("The previous report had no fired issues.");
  else
    for (const item of report.recovery.items)
      lines.push(`- ${item.key}: ${item.state.replace("_", " ")}.`);
  if (report.campaignFollowup) {
    lines.push(
      "",
      "## Campaign follow up",
      "",
      `Campaign: ${report.campaignFollowup.campaign}. Accepted recipients: ${report.campaignFollowup.sentRecipients}. Skipped rows: ${report.campaignFollowup.skippedRows}.`,
      "",
      "| Recipient app | Recipients |",
      "| --- | ---: |",
    );
    for (const [app, recipients] of Object.entries(
      report.campaignFollowup.byRecipientApp,
    ).sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`| ${app} | ${recipients} |`);
    }
    lines.push(
      "",
      "Recipient-level matching uses SHA-256 digests of identified email addresses. This report contains counts only; anonymous landings cannot be assigned to a recipient.",
      "",
      "| Period | Activity app | Recipients | Any visit | UTM landing | Builder connect | First output |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const summary of summarizeCampaignByActivityApp(
      report.campaignFollowup,
    ))
      lines.push(
        `| ${summary.period} | ${summary.activityApp} | ${summary.recipients} | ${summary.anyVisit} | ${summary.campaignLanding} | ${summary.builderConnectSucceeded} | ${summary.firstOutput} |`,
      );
  } else
    lines.push(
      "",
      "## Campaign follow up",
      "",
      "Campaign source file or query was unavailable.",
    );
  if (report.abReadout) lines.push("", formatAbMarkdown(report.abReadout));
  else lines.push("", "## A/B readout", "", "Not available.");
  lines.push("", "## Replay triage", "");
  if (report.triageSummary) {
    for (const [app, outcomes] of Object.entries(report.triageSummary)) {
      lines.push(
        `- ${app}: ${Object.entries(outcomes)
          .map(([outcome, count]) => `${outcome} ${count}`)
          .join(", ")}`,
      );
    }
  } else
    lines.push(
      `Replay triage was unavailable: ${report.triageError ?? "no diagnostic was recorded"}.`,
    );
  lines.push(
    "",
    "## Journey snapshot",
    "",
    report.journeySnapshot.summary ?? report.journeySnapshot.status,
    "",
    "## Feedback ingest",
    "",
    "Agent-run Slack search is required. See the `feedback-ingest` skill; searches are read-only and use its watermark.",
    "",
    "Email addresses and prompt text are excluded from this report.",
  );
  return `${lines.join("\n")}\n`;
}

export async function writeWeeklyReport(
  report: RadarWeeklyReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const directory = path.join(RADAR_TMP_DIR, "runs", report.week);
  const jsonPath = path.join(directory, "radar.json");
  const markdownPath = path.join(directory, "radar.md");
  writePrivate(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writePrivate(markdownPath, formatWeeklyMarkdown(report));
  return { jsonPath, markdownPath };
}

async function main(): Promise<void> {
  try {
    const { week, skipJourneySnapshot, maxTotalGb, freshBigQuery } =
      parseReportArgs(process.argv.slice(2));
    if (!week)
      throw new RadarQueryError(
        "Usage: radar:report --week YYYY-MM-DD [--skip-journey-snapshot] [--max-total-gb N] [--fresh-bigquery]",
        2,
      );
    const report = await buildWeeklyReport(week, {
      skipJourneySnapshot,
      maxTotalGb,
      freshBigQuery,
    });
    const paths = await writeWeeklyReport(report);
    console.log(formatWeeklyMarkdown(report));
    console.log(JSON.stringify({ ...paths, exitCode: report.exitCode }));
    process.exitCode = report.exitCode;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Weekly report could not run.",
    );
    process.exitCode = radarRunCliExitCode(error);
  } finally {
    await closeRadarQueries();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
