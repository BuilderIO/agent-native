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
import {
  RadarQueryError,
  RADAR_TMP_DIR,
  closeRadarQueries,
  radarCliExitCode,
} from "./query.ts";
import { runTriage, type TriageRun } from "./triage.ts";
import { runWatch, type RadarWatchRun } from "./watch.ts";

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

export interface RadarWeeklyReport {
  generatedAt: string;
  week: string;
  weekEnd: string;
  coverage: {
    dailyRuns: { expected: number; completed: number; failedDates: string[] };
    campaignFollowup: boolean;
    abReadout: boolean;
    replayTriage: boolean;
    journeySnapshot: "completed" | "failed" | "not_present";
    feedbackIngest: "agent_required";
    queryCount: number;
  };
  dailyRuns: DailyEntry[];
  triageSummary: TriageRun["byAppOutcome"] | null;
  abReadout: AbReadout | null;
  campaignFollowup: CampaignFollowupResult | null;
  campaignAnnotations: RadarWatchRun["campaignAnnotations"];
  firedIssues: ReportIssue[];
  recovery: {
    available: boolean;
    items: Array<{
      key: string;
      state: "still_broken" | "recovered" | "unknown";
    }>;
  };
  journeySnapshot: {
    status: "completed" | "failed" | "not_present";
    summary?: string;
  };
  feedback: { status: "agent_required"; skill: "feedback-ingest" };
  exitCode: 0 | 1 | 2;
}

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function validMonday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCDay() === 1;
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

function privateDirectory(directory: string): void {
  const relative = path.relative(RADAR_TMP_DIR, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new RadarQueryError(
      "Radar report path is outside the private workspace cache.",
      2,
    );
  fs.mkdirSync(RADAR_TMP_DIR, { recursive: true, mode: 0o700 });
  const root = fs.lstatSync(RADAR_TMP_DIR);
  if (root.isSymbolicLink() || !root.isDirectory())
    throw new RadarQueryError(
      "Radar report path is not a private directory.",
      2,
    );
  fs.chmodSync(RADAR_TMP_DIR, 0o700);
  let cursor = RADAR_TMP_DIR;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      fs.mkdirSync(cursor, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
    const info = fs.lstatSync(cursor);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new RadarQueryError(
        "Radar report path is not a private directory.",
        2,
      );
    fs.chmodSync(cursor, 0o700);
  }
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
): Promise<RadarWeeklyReport> {
  if (!validMonday(week))
    throw new RadarQueryError("--week must be a Monday in YYYY-MM-DD form.", 2);
  const weekEnd = addDays(week, 6);
  const dailyRuns: DailyEntry[] = [];
  let queryCount = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(week, offset);
    try {
      const run = await runWatch({
        date,
        window: "daily",
        includeCampaign: offset === 6,
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
  try {
    triage = await runTriage({ date: weekEnd });
    queryCount += 2;
  } catch {
    triage = null;
  }

  let abReadout: AbReadout | null = null;
  try {
    abReadout = await runAbReadout({ startDate: week, endDate: weekEnd });
    queryCount += 2;
  } catch {
    abReadout = null;
  }

  const journeySnapshot = runJourneySnapshot(week);
  if (journeySnapshot.status !== "not_present") queryCount += 1;
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
  const hasUnavailable = dailyRuns.some((entry) => entry.run?.exitCode === 2);
  const hasFires = dailyRuns.some((entry) => entry.run?.exitCode === 1);
  const exitCode: 0 | 1 | 2 =
    failedDates.length ||
    hasUnavailable ||
    journeySnapshot.status === "failed" ||
    !triage ||
    !abReadout
      ? 2
      : hasFires
        ? 1
        : 0;
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
      feedbackIngest: "agent_required",
      queryCount,
    },
    dailyRuns,
    triageSummary: triage?.byAppOutcome ?? null,
    abReadout,
    campaignFollowup,
    campaignAnnotations,
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

export function formatWeeklyMarkdown(report: RadarWeeklyReport): string {
  const lines = [
    `# First-touch radar report: ${report.week} to ${report.weekEnd}`,
    "",
    `Exit ${report.exitCode}. Daily runs ${report.coverage.dailyRuns.completed}/${report.coverage.dailyRuns.expected}. Query count ${report.coverage.queryCount}.`,
    `Coverage: campaign ${report.coverage.campaignFollowup ? "ready" : "missing"}; A/B ${report.coverage.abReadout ? "ready" : "missing"}; triage ${report.coverage.replayTriage ? "ready" : "missing"}; journey snapshot ${report.coverage.journeySnapshot}; Slack feedback ${report.coverage.feedbackIngest}.`,
    "",
    "## Daily watch",
    "",
    "| Date | Exit | Fired | Unavailable | Error |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const entry of report.dailyRuns) {
    if (!entry.run)
      lines.push(
        `| ${entry.date} | 2 | n/a | n/a | ${entry.error ?? "could not run"} |`,
      );
    else
      lines.push(
        `| ${entry.date} | ${entry.run.exitCode} | ${entry.run.checks.filter((check) => check.status === "fired").length} | ${entry.run.checks.filter((check) => check.status === "unavailable").length} | - |`,
      );
  }
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
      "| Period | Activity app | Recipients | Any visit | UTM landing | Builder connect | First output |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
      "",
      "Recipient-level matching uses identified email fields. Anonymous landings cannot be assigned to a recipient.",
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
  } else lines.push("Replay triage was unavailable.");
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
  const args = process.argv.slice(2);
  let week: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--week") week = args[++index];
    else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  if (!week)
    throw new RadarQueryError("Usage: radar:report --week YYYY-MM-DD", 2);
  try {
    const report = await buildWeeklyReport(week);
    const paths = await writeWeeklyReport(report);
    console.log(formatWeeklyMarkdown(report));
    console.log(JSON.stringify({ ...paths, exitCode: report.exitCode }));
    process.exitCode = report.exitCode;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Weekly report could not run.",
    );
    process.exitCode = radarCliExitCode(error);
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
