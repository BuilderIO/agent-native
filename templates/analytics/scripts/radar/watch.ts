import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCampaignFollowup,
  summarizeCampaignByActivityApp,
  type CampaignFollowupResult,
} from "./campaign.ts";
import {
  RADAR_CHECKS,
  classifyEventChange,
  evaluateThreshold,
  radarExitCode,
  type RadarCheckDefinition,
  type RadarCheckResult,
  type RadarWindow,
} from "./checks.ts";
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
import {
  buildErrorIssuesSql,
  buildEventStatsSql,
  buildFunnelDailySql,
  buildPromptOutputSloSql,
  buildTroubleSql,
  buildUploadRejectionSql,
} from "./sql.ts";
import {
  buildBigQueryEventStatsSql,
  buildBigQueryFunnelDailySql,
  buildBigQueryPromptOutputSloSql,
} from "./warehouse-sql.ts";

interface QueryRow extends Record<string, unknown> {
  app?: unknown;
  event_name?: unknown;
  period_start?: unknown;
}

export interface RadarWatchOptions {
  window?: "hourly" | "daily";
  date?: string;
  hour?: number;
  includeCampaign?: boolean;
}

export interface RadarWatchRun {
  generatedAt: string;
  window: "hourly" | "daily";
  date: string;
  hour?: number;
  exitCode: 0 | 1 | 2;
  checks: RadarCheckResult[];
  campaignFollowup?: CampaignFollowupResult;
  campaignAnnotations: Array<{ app: string; campaigns: string[] }>;
  issues: Array<{
    app: string;
    issueId: string;
    usersAffected: number;
    createdAt: string;
  }>;
  coverage: {
    eventSourceCoverage: Record<string, { runs: number; sourceTagged: number }>;
    campaignRecipients?: number;
    campaignSkippedRows?: number;
  };
  queryCount: number;
}

const ACTION_THRESHOLDS: Record<"design" | "slides" | "clips", number> = {
  design: 0.65,
  slides: 0.72,
  clips: 0.85,
};
const SLO_THRESHOLDS: Record<string, number | undefined> = {
  slides: 600,
  design: 400,
};

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  if (index < 0 || index >= items.length) return undefined;
  return items[index];
}
const APP_OUTPUT: Record<string, string> = {
  design: "design_ready_viewed",
  slides: "deck_created",
  clips: "recording_ready",
};
const APP_PROMPT: Record<string, string> = {
  design: "design_prompt_submitted",
  slides: "generation_started",
  clips: "recording_started",
};

function requireCheckDefinition(id: string): RadarCheckDefinition {
  const definition = RADAR_CHECKS.find((check) => check.id === id);
  if (!definition) {
    throw new RadarQueryError("Radar check definition is missing: " + id, 2);
  }
  return definition;
}

function asDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "");
  const parsed = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );
  if (Number.isFinite(parsed.getTime()))
    return parsed.toISOString().slice(0, 10);
  return text.slice(0, 10);
}

function asHour(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 13);
  const text = String(value ?? "").replace(" ", "T");
  return text.slice(0, 13);
}

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(new Date(`${date}T00:00:00Z`).getTime())
  );
}

function numeric(row: QueryRow | undefined, field: string): number {
  const value = Number(row?.[field] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function eventRows(
  rows: QueryRow[],
  period: string,
  app: string,
  eventName: string,
  window: "hourly" | "daily",
): QueryRow[] {
  return rows.filter((row) => {
    if (String(row.app) !== app || String(row.event_name) !== eventName)
      return false;
    return (
      (window === "hourly"
        ? asHour(row.period_start)
        : asDate(row.period_start)) === period
    );
  });
}

function eventTotal(
  rows: QueryRow[],
  period: string,
  app: string,
  eventName: string,
  field: string,
  window: "hourly" | "daily",
): number {
  return eventRows(rows, period, app, eventName, window).reduce(
    (total, row) => total + numeric(row, field),
    0,
  );
}

function eventCampaigns(
  rows: QueryRow[],
  period: string,
  app: string,
): string[] {
  const values = eventRows(rows, period, app, "signup", "daily")
    .flatMap((row) =>
      Array.isArray(row.signup_campaigns) ? row.signup_campaigns : [],
    )
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  return [...new Set(values)].sort();
}

function baseResult(
  definition: RadarCheckDefinition,
  app: string,
  status: RadarCheckResult["status"],
  details: Partial<
    Pick<
      RadarCheckResult,
      | "value"
      | "baseline"
      | "numerator"
      | "denominator"
      | "detail"
      | "firedMessage"
    >
  > = {},
): RadarCheckResult {
  return { ...definition, app, status, ...details };
}

function thresholdResult(
  definition: RadarCheckDefinition,
  input: {
    app: string;
    n: number;
    value: number | null;
    baseline?: number | null;
    operator?: "lt" | "gt" | "drop_points";
    threshold?: number;
    numerator?: number;
    denominator?: number;
    detail?: string;
  },
): RadarCheckResult {
  const operator = input.operator ?? definition.operator;
  if (operator === "signal") {
    return baseResult(definition, input.app, "observed", input);
  }
  const threshold = input.threshold ?? definition.threshold;
  if (threshold == null)
    return baseResult(definition, input.app, "unavailable", input);
  const status = evaluateThreshold({
    n: input.n,
    minN: definition.minN,
    value: input.value,
    ...(input.baseline !== undefined ? { baseline: input.baseline } : {}),
    operator,
    threshold,
  });
  return baseResult(definition, input.app, status, {
    ...input,
    ...(status === "fired" ? { firedMessage: definition.message } : {}),
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const right = itemAt(sorted, middle);
  const left = itemAt(sorted, middle - 1);
  if (right === undefined) return 0;
  if (sorted.length % 2) return right;
  return left === undefined ? right : (left + right) / 2;
}

function sumFor(
  rows: QueryRow[],
  date: string,
  app: string,
  name: string,
  field: string,
): number {
  return eventTotal(rows, date, app, name, field, "daily");
}

function createEventChecks(
  rows: QueryRow[],
  funnelRows: QueryRow[],
  troubleRows: QueryRow[],
  uploadRows: QueryRow[],
  issueRows: QueryRow[],
  targetDate: string,
  targetHour: string,
  window: "hourly" | "daily",
  campaign?: CampaignFollowupResult,
): {
  checks: RadarCheckResult[];
  annotations: Array<{ app: string; campaigns: string[] }>;
  issues: RadarWatchRun["issues"];
  sourceCoverage: RadarWatchRun["coverage"]["eventSourceCoverage"];
} {
  const checks: RadarCheckResult[] = [];
  const at = window === "hourly" ? targetHour : targetDate;
  const periodDays = Array.from({ length: 7 }, (_, index) =>
    addDays(targetDate, -(index + 1)),
  );
  const sourceCoverage: RadarWatchRun["coverage"]["eventSourceCoverage"] = {};
  const annotations = ["design", "slides", "clips"].map((app) => ({
    app,
    campaigns: eventCampaigns(rows, targetDate, app),
  }));
  const eventCoverageDefinition = {
    ...requireCheckDefinition("event-feed-coverage"),
    window,
  };
  for (const app of ["design", "slides", "clips"] as const) {
    if (!rows.some((row) => String(row.app) === app)) {
      checks.push(
        baseResult(eventCoverageDefinition, app, "unavailable", {
          detail: `No event rows were readable for ${app} in the selected history window.`,
        }),
      );
    }
  }

  if (window === "hourly") {
    const definition = requireCheckDefinition("builder-connect-success");
    for (const app of ["design", "slides", "clips"]) {
      const success =
        eventTotal(
          rows,
          targetHour,
          app,
          "builder_connect_succeeded",
          "events",
          window,
        ) +
        eventTotal(
          rows,
          targetHour,
          app,
          "builder connect succeeded",
          "events",
          window,
        );
      const failure =
        eventTotal(
          rows,
          targetHour,
          app,
          "builder_connect_failed",
          "events",
          window,
        ) +
        eventTotal(
          rows,
          targetHour,
          app,
          "builder connect failed",
          "events",
          window,
        );
      const denominator = success + failure;
      const baselineRates = Array.from({ length: 7 }, (_, index) => {
        const date = addDays(targetDate, -(index + 1));
        const hour = `${date}T${targetHour.slice(11, 13)}`;
        const good =
          eventTotal(
            rows,
            hour,
            app,
            "builder_connect_succeeded",
            "events",
            window,
          ) +
          eventTotal(
            rows,
            hour,
            app,
            "builder connect succeeded",
            "events",
            window,
          );
        const bad =
          eventTotal(
            rows,
            hour,
            app,
            "builder_connect_failed",
            "events",
            window,
          ) +
          eventTotal(
            rows,
            hour,
            app,
            "builder connect failed",
            "events",
            window,
          );
        return good + bad ? good / (good + bad) : null;
      }).filter((value): value is number => value !== null);
      checks.push(
        thresholdResult(definition, {
          app,
          n: denominator,
          value: denominator ? success / denominator : null,
          baseline: baselineRates.length
            ? baselineRates.reduce((a, b) => a + b, 0) / baselineRates.length
            : null,
          numerator: success,
          denominator,
          detail: `${success}/${denominator} terminal connection outcomes in the selected hour.`,
        }),
      );
    }
    for (const app of ["design", "slides"]) {
      const definition = {
        ...requireCheckDefinition("env-key-share"),
        window: "hourly" as const,
      };
      const eventName =
        app === "design" ? "design_prompt_submitted" : "generation_started";
      const runs = eventTotal(
        rows,
        targetHour,
        app,
        eventName,
        "new_user_run_events",
        window,
      );
      const env = eventTotal(
        rows,
        targetHour,
        app,
        eventName,
        "new_user_env_events",
        window,
      );
      const tagged = eventTotal(
        rows,
        targetHour,
        app,
        eventName,
        "new_user_source_events",
        window,
      );
      sourceCoverage[app] = { runs, sourceTagged: tagged };
      const dates = Array.from({ length: 7 }, (_, index) =>
        addDays(targetDate, -(index + 1)),
      );
      const hourOfDay = targetHour.slice(11, 13);
      const baselineRuns = dates.reduce(
        (sum, day) =>
          sum +
          eventTotal(
            rows,
            `${day}T${hourOfDay}`,
            app,
            eventName,
            "new_user_run_events",
            window,
          ),
        0,
      );
      const baselineEnv = dates.reduce(
        (sum, day) =>
          sum +
          eventTotal(
            rows,
            `${day}T${hourOfDay}`,
            app,
            eventName,
            "new_user_env_events",
            window,
          ),
        0,
      );
      const baselineTagged = dates.reduce(
        (sum, day) =>
          sum +
          eventTotal(
            rows,
            `${day}T${hourOfDay}`,
            app,
            eventName,
            "new_user_source_events",
            window,
          ),
        0,
      );
      const untagged = runs > 0 && tagged < runs;
      checks.push(
        thresholdResult(definition, {
          app,
          n: runs,
          value: untagged ? null : runs ? env / runs : null,
          baseline:
            baselineRuns && baselineTagged === baselineRuns
              ? baselineEnv / baselineRuns
              : null,
          numerator: env,
          denominator: runs,
          detail: untagged
            ? `Source properties are present on ${tagged} of ${runs} first-week runs; untagged runs are unknown.`
            : `${env} of ${runs} first-week runs used a deploy environment key.`,
        }),
      );
    }
    return { checks, annotations, issues: [], sourceCoverage };
  }

  for (const app of ["design", "slides"]) {
    const definition = requireCheckDefinition("env-key-share");
    const eventName =
      app === "design" ? "design_prompt_submitted" : "generation_started";
    const runs = eventTotal(
      rows,
      targetDate,
      app,
      eventName,
      "new_user_run_events",
      window,
    );
    const env = eventTotal(
      rows,
      targetDate,
      app,
      eventName,
      "new_user_env_events",
      window,
    );
    const tagged = eventTotal(
      rows,
      targetDate,
      app,
      eventName,
      "new_user_source_events",
      window,
    );
    sourceCoverage[app] = { runs, sourceTagged: tagged };
    const sourceCoverageMissing = runs >= definition.minN && tagged < runs;
    checks.push(
      thresholdResult(definition, {
        app,
        n: runs,
        value: sourceCoverageMissing ? null : runs ? env / runs : null,
        numerator: env,
        denominator: runs,
        detail: sourceCoverageMissing
          ? `Source properties are present on ${tagged} of ${runs} first-week runs; untagged runs are unknown.`
          : `${env} of ${runs} first-week runs used a deploy environment key.`,
      }),
    );
  }

  const setupDefinition = requireCheckDefinition("chat-setup-exposure");
  for (const app of ["design", "slides", "clips"] as const) {
    const signups = sumFor(rows, targetDate, app, "signup", "users");
    const exposures = sumFor(
      rows,
      targetDate,
      app,
      "integration_setup_exposed",
      "chat_setup_exposures",
    );
    const baselineSignups = periodDays.reduce(
      (sum, date) => sum + sumFor(rows, date, app, "signup", "users"),
      0,
    );
    const baselineExposures = periodDays.reduce(
      (sum, date) =>
        sum +
        sumFor(
          rows,
          date,
          app,
          "integration_setup_exposed",
          "chat_setup_exposures",
        ),
      0,
    );
    const baselineRate = baselineSignups
      ? baselineExposures / baselineSignups
      : null;
    checks.push(
      thresholdResult(setupDefinition, {
        app,
        n: signups,
        value:
          baselineRate && baselineRate > 0
            ? exposures / Math.max(1, signups) / baselineRate
            : null,
        baseline: baselineRate,
        threshold: 0.2,
        numerator: exposures,
        denominator: signups,
        detail: `${exposures} chat setup exposures / ${signups} signups; baseline ${baselineExposures}/${baselineSignups}.`,
      }),
    );
  }

  const connectionNoneDef = requireCheckDefinition("ai-connection-none");
  for (const app of ["design", "slides"]) {
    const name =
      app === "design" ? "design_prompt_submitted" : "generation_started";
    const runCount = eventTotal(
      rows,
      targetDate,
      app,
      name,
      "new_user_run_events",
      window,
    );
    const noneCount = eventTotal(
      rows,
      targetDate,
      app,
      name,
      "new_user_no_connection_events",
      window,
    );
    checks.push(
      thresholdResult(connectionNoneDef, {
        app,
        n: runCount,
        value: noneCount,
        numerator: noneCount,
        denominator: runCount,
        detail: `${noneCount} no-connection first-week runs among ${runCount} runs.`,
      }),
    );
  }

  const retryDef = requireCheckDefinition("slides-empty-output-retry");
  const retries = eventTotal(
    rows,
    targetDate,
    "slides",
    "generation_started",
    "empty_output_retry_starts",
    window,
  );
  const newDeck = eventTotal(
    rows,
    targetDate,
    "slides",
    "generation_started",
    "new_deck_prompt_starts",
    window,
  );
  checks.push(
    thresholdResult(retryDef, {
      app: "slides",
      n: newDeck,
      value: newDeck ? retries / newDeck : null,
      numerator: retries,
      denominator: newDeck,
      detail: `${retries} empty-output retries / ${newDeck} new deck prompts.`,
    }),
  );

  const failureDef = requireCheckDefinition("slides-generation-failure");
  const failedUsers = eventTotal(
    rows,
    targetDate,
    "slides",
    "generation_failed",
    "users",
    window,
  );
  const startedUsers = eventTotal(
    rows,
    targetDate,
    "slides",
    "generation_started",
    "users",
    window,
  );
  checks.push(
    thresholdResult(failureDef, {
      app: "slides",
      n: startedUsers,
      value: startedUsers ? failedUsers / startedUsers : null,
      numerator: failedUsers,
      denominator: startedUsers,
      detail: `${failedUsers} failed users / ${startedUsers} generation started users.`,
    }),
  );

  const designDef = requireCheckDefinition("design-prompt-output");
  const designPrompts = eventTotal(
    rows,
    targetDate,
    "design",
    "design_prompt_submitted",
    "users",
    window,
  );
  const designOutputs = eventTotal(
    rows,
    targetDate,
    "design",
    "design_ready_viewed",
    "users",
    window,
  );
  checks.push(
    thresholdResult(designDef, {
      app: "design",
      n: designPrompts,
      value: designPrompts ? designOutputs / designPrompts : null,
      numerator: designOutputs,
      denominator: designPrompts,
      detail: `${designOutputs} ready-output users / ${designPrompts} prompt users.`,
    }),
  );

  const savesDef = requireCheckDefinition("clips-local-saves");
  const localSaves = eventTotal(
    rows,
    targetDate,
    "clips",
    "clips_local_recording_saved",
    "events",
    window,
  );
  checks.push(
    thresholdResult(savesDef, {
      app: "clips",
      n: localSaves,
      value: localSaves,
      numerator: localSaves,
      detail: `${localSaves} local saves.`,
    }),
  );

  const clipsDef = requireCheckDefinition("clips-ready-rate");
  const recordingStarts = eventTotal(
    rows,
    targetDate,
    "clips",
    "recording_started",
    "events",
    window,
  );
  const readyClips = eventTotal(
    rows,
    targetDate,
    "clips",
    "recording_ready",
    "events",
    window,
  );
  checks.push(
    thresholdResult(clipsDef, {
      app: "clips",
      n: recordingStarts,
      value: recordingStarts ? readyClips / recordingStarts : null,
      numerator: readyClips,
      denominator: recordingStarts,
      detail: `${readyClips} ready clips / ${recordingStarts} recording starts.`,
    }),
  );

  const troubleDef = requireCheckDefinition("session-trouble-pair");
  for (const row of troubleRows) {
    const app = String(row.app ?? "unknown");
    const denominator = numeric(row, "sessions");
    const trouble = numeric(row, "sessions_with_pair");
    if (!row.action) continue;
    checks.push(
      thresholdResult(troubleDef, {
        app,
        n: denominator,
        value: denominator ? trouble / denominator : null,
        numerator: trouble,
        denominator,
        detail: `${String(row.action)} / ${String(row.status)} affected ${trouble}/${denominator} sessions.`,
      }),
    );
  }

  const uploadDef = requireCheckDefinition("replay-upload-rejection");
  for (const row of uploadRows) {
    const denominator = numeric(row, "recorders");
    const rejected = numeric(row, "rejected_recorders");
    if (rejected === 0) continue;
    checks.push(
      thresholdResult(uploadDef, {
        app: String(row.app ?? "unknown"),
        n: denominator,
        value: denominator ? rejected / denominator : null,
        numerator: rejected,
        denominator,
        detail: `${rejected}/${denominator} recorders rejected (${String(row.reason)} / ${String(row.status)}).`,
      }),
    );
  }

  const funnelDef = requireCheckDefinition("first-touch-funnel-drop");
  const funnelStages = [
    { key: "signup-to-onboarding", parent: "signups", child: "completed" },
    { key: "onboarding-to-app-entry", parent: "completed", child: "entered" },
    { key: "app-entry-to-first-run", parent: "entered", child: "prompted" },
    { key: "first-run-to-output", parent: "prompted", child: "output" },
  ] as const;
  for (const app of ["design", "slides", "clips"]) {
    const target = funnelRows.find(
      (row) =>
        asDate(row.signup_date) === targetDate && String(row.app) === app,
    );
    for (const stage of funnelStages) {
      const numerator = numeric(target, stage.child);
      const denominator = numeric(target, stage.parent);
      const baselineRows = periodDays.map((date) =>
        funnelRows.find(
          (row) => asDate(row.signup_date) === date && String(row.app) === app,
        ),
      );
      const baselineN = baselineRows.reduce(
        (sum, row) => sum + numeric(row, stage.parent),
        0,
      );
      const baselineK = baselineRows.reduce(
        (sum, row) => sum + numeric(row, stage.child),
        0,
      );
      checks.push(
        thresholdResult(funnelDef, {
          app,
          n: denominator,
          value: denominator ? numerator / denominator : null,
          baseline: baselineN ? baselineK / baselineN : null,
          numerator,
          denominator,
          detail: `${stage.key}: ${numerator}/${denominator}; seven day ${baselineK}/${baselineN}.`,
        }),
      );
    }
  }

  const signupDef = requireCheckDefinition("signup-volume-drop");
  for (const app of ["design", "slides", "clips"]) {
    const current = sumFor(rows, targetDate, app, "signup", "users");
    const samples = periodDays.map((date) =>
      sumFor(rows, date, app, "signup", "users"),
    );
    const baseline = median(samples);
    if (baseline < 10) {
      checks.push(
        baseResult(signupDef, app, "insufficient", {
          value: current,
          baseline,
          numerator: current,
          denominator: baseline,
          detail: `${current} signups vs seven day median ${baseline}; baseline median is below 10.`,
        }),
      );
      continue;
    }
    checks.push(
      thresholdResult(signupDef, {
        app,
        n: 0,
        value: baseline ? current / baseline : null,
        baseline,
        threshold: 0.3,
        numerator: current,
        denominator: baseline,
        detail: `${current} signups vs seven day median ${baseline}; campaigns ${eventCampaigns(rows, targetDate, app).join(", ") || "none tagged"}.`,
      }),
    );
  }

  const eventDef = requireCheckDefinition("event-first-seen-or-zero");
  for (const app of ["design", "slides", "clips"]) {
    const eventNames = new Set(
      rows
        .filter((row) => String(row.app) === app)
        .map((row) => String(row.event_name)),
    );
    for (const eventName of eventNames) {
      const currentCount = eventTotal(
        rows,
        targetDate,
        app,
        eventName,
        "events",
        window,
      );
      const previous = periodDays.reduce(
        (sum, date) => sum + sumFor(rows, date, app, eventName, "events"),
        0,
      );
      const previousThirtyDays = rows.reduce((sum, row) => {
        const rowDate = asDate(row.period_start);
        return rowDate >= addDays(targetDate, -30) &&
          rowDate < targetDate &&
          String(row.app) === app &&
          String(row.event_name) === eventName
          ? sum + numeric(row, "events")
          : sum;
      }, 0);
      const change = classifyEventChange({
        currentCount,
        previousSevenDayCount: previous,
        previousThirtyDayCount: previousThirtyDays,
        minN: eventDef.minN,
      });
      if (change === "first_seen") {
        checks.push(
          baseResult(eventDef, app, "fired", {
            value: currentCount,
            numerator: currentCount,
            detail: `${eventName} was first seen in the 30 day window (${currentCount} events).`,
          }),
        );
      } else if (change === "went_to_zero") {
        checks.push(
          baseResult(eventDef, app, "fired", {
            value: 0,
            baseline: previous / 7,
            numerator: 0,
            detail: `${eventName} had ${previous} events in the previous seven days and none on ${targetDate}.`,
          }),
        );
      }
    }
  }

  const actionDef = requireCheckDefinition("action-success-rate");
  for (const app of ["design", "slides", "clips"] as const) {
    const row = eventRows(rows, targetDate, app, "action.response", "daily")[0];
    const total = numeric(row, "action_weight");
    const success = numeric(row, "action_success_weight");
    const threshold = ACTION_THRESHOLDS[app];
    checks.push(
      thresholdResult(actionDef, {
        app,
        n: numeric(row, "events"),
        value: total ? success / total : null,
        baseline: threshold,
        threshold,
        numerator: success,
        denominator: total,
        detail: `${success}/${total} weighted action responses; calibrated threshold ${(threshold * 100).toFixed(0)}%.`,
      }),
    );
  }

  const issues = issueRows.map((row) => ({
    app: String(row.app ?? "unknown"),
    issueId: String(row.id ?? ""),
    usersAffected: numeric(row, "users_affected"),
    createdAt: String(row.created_at ?? ""),
  }));
  const issueDef = requireCheckDefinition("new-error-issues");
  for (const app of ["design", "slides", "clips"]) {
    const appIssues = issues.filter((issue) => issue.app === app);
    if (appIssues.length) {
      checks.push(
        thresholdResult(issueDef, {
          app,
          n: appIssues.length,
          value: appIssues.length,
          numerator: appIssues.length,
          denominator: 5,
          detail: `${appIssues.length} new issues affected at least five users.`,
          threshold: 0,
          operator: "gt",
        }),
      );
    }
  }

  if (campaign) {
    const campaignDef = requireCheckDefinition("campaign-followup");
    checks.push(
      baseResult(campaignDef, "*", "observed", {
        denominator: campaign.sentRecipients,
        detail: `${campaign.sentRecipients} accepted recipients counted; ${campaign.skippedRows} rows were not accepted sends.`,
      }),
    );
  }

  return { checks, annotations, issues, sourceCoverage };
}

export async function runWatch(
  options: RadarWatchOptions = {},
): Promise<RadarWatchRun> {
  const window = options.window ?? "daily";
  const currentHour = new Date(Date.now() - 60 * 60 * 1000);
  currentHour.setUTCMinutes(0, 0, 0);
  const date =
    options.date ??
    (window === "daily"
      ? addDays(new Date().toISOString().slice(0, 10), -1)
      : currentHour.toISOString().slice(0, 10));
  if (!validDate(date))
    throw new RadarQueryError("--date must be YYYY-MM-DD.", 2);
  const hour = options.hour ?? currentHour.getUTCHours();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RadarQueryError("--hour must be between 0 and 23 UTC.", 2);
  }
  const hourKey = `${date}T${String(hour).padStart(2, "0")}`;
  const orgId = await resolveRadarOrganizationId();
  const backend = await resolveRadarFirstPartyBackend();
  const eventStart = addDays(date, window === "daily" ? -30 : -14);
  const eventResult =
    backend.sink === "bigquery"
      ? await runBigQuery(
          buildBigQueryEventStatsSql(
            await resolveRadarBigQueryEventsTable(),
            window === "hourly" ? "HOUR" : "DAY",
          ),
          {
            params: [
              { name: "start_date", type: "DATE", value: eventStart },
              { name: "end_date", type: "DATE", value: date },
              { name: "org_id", type: "STRING", value: orgId },
            ],
          },
        )
      : await runPostgresQuery(buildEventStatsSql(), [
          eventStart,
          date,
          orgId,
          window === "hourly" ? "hour" : "day",
        ]);
  const eventRowsData = eventResult.rows as QueryRow[];
  const queryCount = 3;
  let funnelRows: QueryRow[] = [];
  let troubleRows: QueryRow[] = [];
  let uploadRows: QueryRow[] = [];
  let issueRows: QueryRow[] = [];
  let sloRows: QueryRow[] = [];
  let campaign: CampaignFollowupResult | undefined;
  let additionalQueries = 0;

  if (window === "daily") {
    const funnelStart = addDays(date, -8);
    const funnelEnd = addDays(date, 1);
    const [funnel, trouble, upload, issues, slo] = await Promise.all([
      backend.sink === "bigquery"
        ? runBigQuery(
            buildBigQueryFunnelDailySql(
              await resolveRadarBigQueryEventsTable(),
            ),
            {
              params: [
                { name: "start_date", type: "DATE", value: funnelStart },
                { name: "end_date", type: "DATE", value: funnelEnd },
                { name: "org_id", type: "STRING", value: orgId },
              ],
            },
          )
        : runPostgresQuery(buildFunnelDailySql(), [
            funnelStart,
            funnelEnd,
            orgId,
          ]),
      runPostgresQuery(buildTroubleSql(), [date, date, orgId]),
      runPostgresQuery(buildUploadRejectionSql(), [date, date, orgId]),
      runPostgresQuery(buildErrorIssuesSql(), [
        orgId,
        `${date}T00:00:00.000Z`,
        `${addDays(date, 1)}T00:00:00.000Z`,
      ]),
      backend.sink === "bigquery"
        ? runBigQuery(
            buildBigQueryPromptOutputSloSql(
              await resolveRadarBigQueryEventsTable(),
            ),
            {
              params: [
                { name: "start_date", type: "DATE", value: addDays(date, -6) },
                { name: "end_date", type: "DATE", value: date },
                { name: "org_id", type: "STRING", value: orgId },
              ],
            },
          )
        : runPostgresQuery(buildPromptOutputSloSql(), [
            addDays(date, -6),
            date,
            orgId,
          ]),
    ]);
    funnelRows = funnel.rows as QueryRow[];
    troubleRows = trouble.rows as QueryRow[];
    uploadRows = upload.rows as QueryRow[];
    issueRows = issues.rows as QueryRow[];
    sloRows = slo.rows as QueryRow[];
    additionalQueries = 5;
    if (options.includeCampaign !== false) {
      campaign = await runCampaignFollowup(orgId);
      additionalQueries += 1;
    }
  }

  const evaluated = createEventChecks(
    eventRowsData,
    funnelRows,
    troubleRows,
    uploadRows,
    issueRows,
    date,
    hourKey,
    window,
    campaign,
  );
  if (window === "daily") {
    const sloDefinition = requireCheckDefinition("prompt-output-p90");
    for (const row of sloRows) {
      const app = String(row.app ?? "unknown");
      const threshold = SLO_THRESHOLDS[app];
      if (threshold == null) continue;
      const p90 = Number(row.p90_seconds);
      const n = numeric(row, "sample_size");
      evaluated.checks.push(
        thresholdResult(sloDefinition, {
          app,
          n,
          value: Number.isFinite(p90) ? p90 : null,
          threshold,
          operator: "gt",
          numerator: p90,
          denominator: n,
          detail: `Seven day prompt to first output p90 ${Number.isFinite(p90) ? `${p90.toFixed(1)}s` : "unavailable"}; SLO ${threshold}s.`,
        }),
      );
    }
  }
  const exitCode = radarExitCode(evaluated.checks);
  return {
    generatedAt: new Date().toISOString(),
    window,
    date,
    ...(window === "hourly" ? { hour } : {}),
    exitCode,
    checks: evaluated.checks,
    ...(campaign ? { campaignFollowup: campaign } : {}),
    campaignAnnotations: evaluated.annotations,
    issues: evaluated.issues,
    coverage: {
      eventSourceCoverage: evaluated.sourceCoverage,
      ...(campaign
        ? {
            campaignRecipients: campaign.sentRecipients,
            campaignSkippedRows: campaign.skippedRows,
          }
        : {}),
    },
    queryCount: queryCount + additionalQueries,
  };
}

function privateOutputDirectory(directory: string): void {
  const relative = path.relative(RADAR_TMP_DIR, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RadarQueryError(
      "Radar output directory is outside the private workspace cache.",
      2,
    );
  }
  fs.mkdirSync(RADAR_TMP_DIR, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(RADAR_TMP_DIR);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new RadarQueryError(
      "Radar output path is not a private directory.",
      2,
    );
  }
  fs.chmodSync(RADAR_TMP_DIR, 0o700);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new RadarQueryError(
      "Radar output path is not a private directory.",
      2,
    );
  }
  fs.chmodSync(directory, 0o700);
}

function writePrivateFile(file: string, content: string): void {
  privateOutputDirectory(path.dirname(file));
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

function formatWatchMarkdown(run: RadarWatchRun): string {
  const lines = [
    `# First-touch radar: ${run.date}${run.window === "hourly" ? ` ${String(run.hour).padStart(2, "0")}:00 UTC` : ""}`,
    "",
    `Exit ${run.exitCode}. ${run.checks.filter((check) => check.status === "fired").length} fired, ${run.checks.filter((check) => check.status === "unavailable").length} unavailable, ${run.queryCount} queries.`,
    "",
    "| Status | Check | App | Value | Baseline | Detail |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];
  for (const check of run.checks) {
    if (
      check.status === "clear" ||
      check.status === "insufficient" ||
      check.status === "observed"
    )
      continue;
    lines.push(
      `| ${check.status} | ${check.id} | ${check.app} | ${check.value == null ? "n/a" : Number(check.value).toFixed(3)} | ${check.baseline == null ? "n/a" : Number(check.baseline).toFixed(3)} | ${check.detail ?? check.message} |`,
    );
  }
  if (run.campaignFollowup) {
    lines.push(
      "",
      "## Outage recovery email follow-up",
      "",
      `Accepted recipients: ${run.campaignFollowup.sentRecipients}. Skipped non-accepted rows: ${run.campaignFollowup.skippedRows}.`,
      "",
      "| Recipient app | Recipients |",
      "| --- | ---: |",
    );
    for (const [app, recipients] of Object.entries(
      run.campaignFollowup.byRecipientApp,
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
      run.campaignFollowup,
    )) {
      lines.push(
        `| ${summary.period} | ${summary.activityApp} | ${summary.recipients} | ${summary.anyVisit} | ${summary.campaignLanding} | ${summary.builderConnectSucceeded} | ${summary.firstOutput} |`,
      );
    }
  }
  lines.push("", "## Signup campaign tags", "");
  for (const item of run.campaignAnnotations) {
    lines.push(
      `- ${item.app}: ${item.campaigns.join(", ") || "no signup UTM campaign tagged"}`,
    );
  }
  if (run.issues.length) {
    lines.push(
      "",
      "## New error issues",
      "",
      "| App | Issue id | Users affected | Created |",
      "| --- | --- | ---: | --- |",
    );
    for (const issue of run.issues)
      lines.push(
        `| ${issue.app} | ${issue.issueId} | ${issue.usersAffected} | ${issue.createdAt} |`,
      );
  }
  lines.push("", "No email addresses or prompt text are included.");
  return `${lines.join("\n")}\n`;
}

export async function writeWatchRun(
  run: RadarWatchRun,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const directory = path.join(RADAR_TMP_DIR, "runs", run.date);
  const jsonPath = path.join(
    directory,
    `radar-watch-${run.window}${run.window === "hourly" ? `-${String(run.hour).padStart(2, "0")}` : ""}.json`,
  );
  const markdownPath = jsonPath.replace(/\.json$/, ".md");
  writePrivateFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
  writePrivateFile(markdownPath, formatWatchMarkdown(run));
  return { jsonPath, markdownPath };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let window: "hourly" | "daily" = "daily";
  let date: string | undefined;
  let hour: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--window") {
      const value = args[++index];
      if (value !== "hourly" && value !== "daily")
        throw new RadarQueryError("--window must be hourly or daily.", 2);
      window = value;
    } else if (args[index] === "--date") date = args[++index];
    else if (args[index] === "--hour") hour = Number(args[++index]);
    else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  try {
    const run = await runWatch({
      window,
      ...(date !== undefined ? { date } : {}),
      ...(hour !== undefined ? { hour } : {}),
    });
    const paths = await writeWatchRun(run);
    console.log(formatWatchMarkdown(run));
    console.log(JSON.stringify({ ...paths, exitCode: run.exitCode }));
    process.exitCode = run.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Radar watch could not run.";
    console.error(message);
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
