import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RadarQueryError,
  RADAR_TMP_DIR,
  closeRadarQueries,
  radarCliExitCode,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  resolveRadarOrganizationId,
  runBigQuery,
  runPostgresQuery,
} from "./query.ts";
import { buildTriageMetadataSql, buildTriageSql } from "./sql.ts";
import { buildBigQueryTriageEventsSql } from "./warehouse-sql.ts";

export interface TriageSession {
  session_id: string;
  recording_id: string | null;
  app: string;
  outcome: string;
  trouble_labels: string;
  friction_signals: number;
  performance_summary: string;
  timeline: string;
}

export interface TriageRun {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  sessions: TriageSession[];
  byAppOutcome: Record<string, Record<string, number>>;
}

export function triageMetadataParams(
  selected: Array<{ session_id: string; app: string; signup_at: string }>,
  orgId: string,
  windowEnd: string,
): unknown[] {
  return [JSON.stringify(selected), orgId, windowEnd];
}

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function validateDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    throw new RadarQueryError("--date must be YYYY-MM-DD.", 2);
  }
}

export async function runTriage(
  options: { date?: string } = {},
): Promise<TriageRun> {
  const now = new Date();
  const windowEnd = options.date
    ? `${addDays(options.date, 1)}T00:00:00.000Z`
    : now.toISOString();
  const windowStart = options.date
    ? `${options.date}T00:00:00.000Z`
    : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (options.date) validateDate(options.date);
  const eventStart = addDays(windowStart.slice(0, 10), -1);
  const eventEnd = addDays(windowEnd.slice(0, 10), 1);
  const orgId = await resolveRadarOrganizationId();
  const backend = await resolveRadarFirstPartyBackend();
  let sessions: TriageSession[];
  if (backend.sink === "bigquery") {
    const eventsTableRange = await resolveRadarBigQueryEventsTable();
    const { rows: eventRows } = await runBigQuery(
      buildBigQueryTriageEventsSql(eventsTableRange),
      {
        params: [
          { name: "event_start_date", type: "DATE", value: eventStart },
          {
            name: "event_end_date",
            type: "DATE",
            value: windowEnd.slice(0, 10),
          },
          { name: "org_id", type: "STRING", value: orgId },
          { name: "window_start", type: "TIMESTAMP", value: windowStart },
          { name: "window_end", type: "TIMESTAMP", value: windowEnd },
        ],
        fresh: true,
        cache: false,
      },
    );
    const selected = eventRows.map((row) => ({
      session_id: String(row.session_id ?? ""),
      app: String(row.app ?? "unknown"),
      signup_at: String(row.signup_at ?? ""),
    }));
    const metadataRows = selected.length
      ? (
          await runPostgresQuery(
            buildTriageMetadataSql(),
            triageMetadataParams(selected, orgId, windowEnd),
            { fresh: true },
          )
        ).rows
      : [];
    const metadataBySession = new Map(
      metadataRows.map((row) => [String(row.session_id ?? ""), row]),
    );
    const outcomeRank: Record<string, number> = {
      prompted_no_output: 1,
      recording_started_no_ready_clip: 2,
      onboarding_abandoned: 3,
      output_ready: 8,
      no_prompt_or_output: 9,
    };
    sessions = eventRows
      .map((row) => {
        const sessionId = String(row.session_id ?? "");
        const metadata = metadataBySession.get(sessionId);
        const prompted = row.prompted === true;
        const recordingStarted = row.recording_started === true;
        const outputReady = row.output_ready === true;
        const abandoned = row.onboarding_abandoned === true;
        const outcome =
          prompted && !outputReady
            ? "prompted_no_output"
            : recordingStarted && !outputReady
              ? "recording_started_no_ready_clip"
              : abandoned
                ? "onboarding_abandoned"
                : outputReady
                  ? "output_ready"
                  : "no_prompt_or_output";
        return {
          session_id: sessionId,
          recording_id:
            typeof metadata?.recording_id === "string" && metadata.recording_id
              ? metadata.recording_id
              : null,
          app: String(row.app ?? "unknown"),
          outcome,
          trouble_labels: String(metadata?.trouble_labels ?? ""),
          friction_signals: Number(metadata?.friction_signals ?? 0),
          performance_summary: String(metadata?.performance_summary ?? ""),
          timeline: String(metadata?.indexed_timeline || row.timeline || ""),
          signup_at: String(row.signup_at ?? ""),
        };
      })
      .sort((left, right) => {
        const rank =
          (outcomeRank[left.outcome] ?? 10) -
          (outcomeRank[right.outcome] ?? 10);
        return rank || right.signup_at.localeCompare(left.signup_at);
      })
      .slice(0, 30)
      .map(({ signup_at: _signupAt, ...session }) => session);
  } else {
    const { rows } = await runPostgresQuery(
      buildTriageSql(),
      [
        eventStart,
        eventEnd,
        orgId,
        windowStart,
        options.date ? `${addDays(options.date, 1)}T00:00:00.000Z` : windowEnd,
      ],
      { fresh: true },
    );
    sessions = rows.map((row) => ({
      session_id: String(row.session_id ?? ""),
      recording_id:
        typeof row.recording_id === "string" ? row.recording_id : null,
      app: String(row.app ?? "unknown"),
      outcome: String(row.outcome ?? "unknown"),
      trouble_labels: String(row.trouble_labels ?? ""),
      friction_signals: Number(row.friction_signals ?? 0),
      performance_summary: String(row.performance_summary ?? ""),
      timeline: String(row.timeline ?? ""),
    }));
  }
  const byAppOutcome: Record<string, Record<string, number>> = {};
  for (const session of sessions) {
    const outcomes = byAppOutcome[session.app] ?? {};
    outcomes[session.outcome] = (outcomes[session.outcome] ?? 0) + 1;
    byAppOutcome[session.app] = outcomes;
  }
  return {
    generatedAt: new Date().toISOString(),
    windowStart,
    windowEnd,
    sessions,
    byAppOutcome,
  };
}

function preparePrivateDirectory(directory: string): void {
  const relative = path.relative(RADAR_TMP_DIR, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RadarQueryError(
      "Radar output directory is outside the private workspace cache.",
      2,
    );
  }
  fs.mkdirSync(RADAR_TMP_DIR, { recursive: true, mode: 0o700 });
  const root = fs.lstatSync(RADAR_TMP_DIR);
  if (root.isSymbolicLink() || !root.isDirectory())
    throw new RadarQueryError(
      "Radar output path is not a private directory.",
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
        "Radar output path is not a private directory.",
        2,
      );
    fs.chmodSync(cursor, 0o700);
  }
}

function writePrivate(file: string, content: string): void {
  preparePrivateDirectory(path.dirname(file));
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
    throw new RadarQueryError("Radar output target is not a regular file.", 2);
  }
  fs.renameSync(temporary, file);
}

function formatTriageMarkdown(run: TriageRun): string {
  const lines = [
    "# First-touch replay triage",
    "",
    `Window: ${run.windowStart} to ${run.windowEnd}. Sessions: ${run.sessions.length}.`,
    "",
    "| App | Outcome | Count |",
    "| --- | --- | ---: |",
  ];
  for (const [app, outcomes] of Object.entries(run.byAppOutcome)) {
    for (const [outcome, count] of Object.entries(outcomes))
      lines.push(`| ${app} | ${outcome} | ${count} |`);
  }
  lines.push(
    "",
    "## Highest priority sessions",
    "",
    "| App | Outcome | Recording | Trouble | Performance | Timeline |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const session of run.sessions.slice(0, 30)) {
    lines.push(
      `| ${session.app} | ${session.outcome} | ${session.recording_id ?? "no recording"} | ${session.trouble_labels || "none indexed"} | ${session.performance_summary || "none indexed"} | ${session.timeline || "no indexed timeline"} |`,
    );
  }
  lines.push(
    "",
    "Sessions rank by outcome first. Friction and performance are explanatory only. Email addresses and prompt text are excluded.",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let date: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--date") date = args[++index];
    else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  try {
    const run = await runTriage(date === undefined ? {} : { date });
    const directory = path.join(
      RADAR_TMP_DIR,
      "runs",
      run.windowStart.slice(0, 10),
    );
    const jsonPath = path.join(directory, "radar-triage.json");
    const markdownPath = path.join(directory, "radar-triage.md");
    writePrivate(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
    writePrivate(markdownPath, formatTriageMarkdown(run));
    console.log(formatTriageMarkdown(run));
    console.log(JSON.stringify({ jsonPath, markdownPath }));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Replay triage could not run.",
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
