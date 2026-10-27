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
  EVENT_WENT_TO_ZERO_MIN_N,
  RADAR_CHECKS,
  classifyEventChange,
  evaluateThreshold,
  radarExitCode,
  type RadarCheckDefinition,
  type RadarCheckResult,
} from "./checks.ts";
import { safeRadarEventLabel } from "./event-labels.ts";
import { addLinkedEventMetricsSql } from "./linked-events-sql.ts";
import {
  RadarQueryError,
  RADAR_TMP_DIR,
  closeRadarQueries,
  ensureRadarPrivateDirectory,
  radarJsonbParam,
  radarRunCliExitCode,
  requiredRadarCliValue,
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
  buildUploadRejectionAttributionSql,
  buildUploadRejectionSql,
} from "./sql.ts";
import {
  buildBigQueryEventStatsSql,
  buildBigQueryFunnelDailySql,
  buildBigQueryPromptOutputSloSql,
  buildBigQueryUploadRejectionSql,
} from "./warehouse-sql.ts";

interface QueryRow extends Record<string, unknown> {
  app?: unknown;
  event_name?: unknown;
  period_start?: unknown;
  signup_date?: unknown;
  journey_type?: unknown;
}

interface JourneyRow extends QueryRow {
  app: string;
  journey_type: string;
}

export interface RadarWatchOptions {
  window?: "hourly" | "daily";
  date?: string;
  hour?: number;
  includeCampaign?: boolean;
  prefetched?: RadarWatchPrefetchedQueries;
  cutoff?: Date;
}

export interface RadarWatchPrefetchedQueries {
  eventRows: Record<string, unknown>[];
  funnelRows: Record<string, unknown>[];
  sloRows: Record<string, unknown>[];
  uploadRows: Record<string, unknown>[];
}

export interface RadarWatchRun {
  generatedAt: string;
  window: "hourly" | "daily";
  date: string;
  hour?: number;
  exitCode: 0 | 1;
  checks: RadarCheckResult[];
  journeyRows: JourneyRow[];
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
    funnelCohortDate?: string;
    campaignRecipients?: number;
    campaignSkippedRows?: number;
    campaignFollowupAvailable?: boolean;
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

export function matureFunnelCohortDate(
  requestedDate: string,
  cutoff: Date,
): string {
  if (!validDate(requestedDate) || !Number.isFinite(cutoff.getTime())) {
    throw new RadarQueryError("Funnel cohort date inputs are invalid.", 2);
  }
  const latestMatureDate = addDays(cutoff.toISOString().slice(0, 10), -2);
  return requestedDate < latestMatureDate ? requestedDate : latestMatureDate;
}

function validDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
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
    return periodMatches(row, period, window);
  });
}

function periodMatches(
  row: QueryRow,
  period: string,
  window: "hourly" | "daily",
): boolean {
  return (
    (window === "hourly"
      ? asHour(row.period_start)
      : asDate(row.period_start)) === period
  );
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

const SAFE_CAMPAIGN_LABELS = new Set(["outage_recovery_20261026"]);

export function safeCampaignLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_CAMPAIGN_LABELS.has(normalized) ? normalized : "other";
}

export async function loadUploadRejectionRows(
  backend: { sink: "postgres" | "dual" | "bigquery"; table: string | null },
  date: string,
  orgId: string,
  prefetchedRows?: readonly QueryRow[],
): Promise<QueryRow[]> {
  if (backend.sink !== "bigquery") {
    const { rows } = await runPostgresQuery(buildUploadRejectionSql(), [
      date,
      date,
      orgId,
    ]);
    return rows as QueryRow[];
  }

  let rejectedRows = prefetchedRows
    ? prefetchedRows.filter((row) => asDate(row.event_date) === date)
    : undefined;
  if (!rejectedRows) {
    const table = await resolveRadarBigQueryEventsTable();
    const rejected = await runBigQuery(buildBigQueryUploadRejectionSql(table), {
      params: [
        { name: "start_date", type: "DATE", value: date },
        { name: "end_date", type: "DATE", value: date },
        { name: "org_id", type: "STRING", value: orgId },
      ],
      fresh: true,
      cache: false,
    });
    rejectedRows = rejected.rows as QueryRow[];
  }
  if (!rejectedRows.length) return [];
  const rejectionGroups = rejectedRows.map((row) => {
    const sessionIds = row.rejected_session_ids;
    if (
      !Array.isArray(sessionIds) ||
      sessionIds.some(
        (sessionId) => typeof sessionId !== "string" || !sessionId,
      )
    ) {
      throw new RadarQueryError(
        "BigQuery returned invalid replay rejection session ids.",
        1,
      );
    }
    const unidentifiedRejections = Number(row.unidentified_rejections);
    if (
      !Number.isSafeInteger(unidentifiedRejections) ||
      unidentifiedRejections < 0
    ) {
      throw new RadarQueryError(
        "BigQuery returned invalid replay rejection counts.",
        1,
      );
    }
    return {
      app: String(row.app ?? "unknown"),
      reason: String(row.reason ?? "unknown"),
      status: String(row.status ?? "unknown"),
      session_ids: [...new Set(sessionIds as string[])],
      unidentified_rejections: unidentifiedRejections,
    };
  });
  const recorders = await runPostgresQuery(
    buildUploadRejectionAttributionSql(),
    [date, date, orgId, radarJsonbParam(rejectionGroups)],
    { fresh: true },
  );
  return recorders.rows as QueryRow[];
}

export function uploadRejectionCheck(
  row: QueryRow,
  definition = requireCheckDefinition("replay-upload-rejection"),
): RadarCheckResult | undefined {
  const app = String(row.app ?? "unknown");
  const rejectedValue = row.rejected_recorders;
  const unidentifiedValue = row.unidentified_rejections;
  const rejected = Number(rejectedValue);
  const unidentified = Number(unidentifiedValue);
  if (
    rejectedValue == null ||
    unidentifiedValue == null ||
    !Number.isSafeInteger(rejected) ||
    rejected < 0 ||
    !Number.isSafeInteger(unidentified) ||
    unidentified < 0
  ) {
    return baseResult(definition, app, "unavailable", {
      detail: "Replay upload rejection counts are unavailable.",
    });
  }
  if (rejected === 0 && unidentified === 0) return undefined;
  if (unidentified > 0) {
    return baseResult(definition, app, "unavailable", {
      numerator: rejected,
      detail: `${unidentified} rejection events lacked a session id; the recorder rate is unavailable.`,
    });
  }
  const denominator = Number(row.recorders);
  if (
    row.recorders == null ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    return baseResult(definition, app, "unavailable", {
      numerator: rejected,
      denominator: null,
      detail: `${rejected} replay upload rejections (${String(row.reason)} / ${String(row.status)}); recorder denominator is unavailable.`,
    });
  }
  return thresholdResult(definition, {
    app,
    n: denominator,
    value: rejected / denominator,
    numerator: rejected,
    denominator,
    detail: `${rejected}/${denominator} recorders rejected (${String(row.reason)} / ${String(row.status)}).`,
  });
}

export function campaignUnavailableCheck(detail: string): RadarCheckResult {
  return baseResult(
    requireCheckDefinition("campaign-followup"),
    "*",
    "unavailable",
    { detail: `Campaign follow-up unavailable: ${detail}` },
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
    )
    .map(safeCampaignLabel);
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

function safeCount(row: QueryRow, field: string): number | null {
  const value = row[field];
  if (value == null) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function linkedDailyRateCheck(input: {
  rows: QueryRow[];
  definition: RadarCheckDefinition;
  targetDate: string;
  app: string;
  startEvent: string;
  denominatorField: string;
  numeratorField: string;
  unlinkedField: string;
  metricLabel: string;
}): RadarCheckResult {
  const startRows = eventRows(
    input.rows,
    input.targetDate,
    input.app,
    input.startEvent,
    "daily",
  );
  if (startRows.length === 0) {
    return thresholdResult(input.definition, {
      app: input.app,
      n: 0,
      value: null,
      numerator: 0,
      denominator: 0,
      detail: `No ${input.metricLabel} starts in the selected day.`,
    });
  }
  if (startRows.length !== 1) {
    return baseResult(input.definition, input.app, "unavailable", {
      detail: `${input.metricLabel} daily linkage returned an ambiguous start row.`,
    });
  }

  const row = itemAt(startRows, 0);
  if (!row) {
    return baseResult(input.definition, input.app, "unavailable", {
      detail: `${input.metricLabel} daily linkage is unavailable.`,
    });
  }
  const denominator = safeCount(row, input.denominatorField);
  const numerator = safeCount(row, input.numeratorField);
  const unlinked = safeCount(row, input.unlinkedField);
  if (denominator === null || numerator === null || unlinked === null) {
    return baseResult(input.definition, input.app, "unavailable", {
      detail: `${input.metricLabel} linkage counts are missing or invalid.`,
    });
  }
  if (unlinked > 0) {
    return baseResult(input.definition, input.app, "unavailable", {
      numerator,
      denominator,
      detail: `${unlinked} ${input.metricLabel} events lacked a linkage key; the rate is unavailable.`,
    });
  }
  if (numerator > denominator) {
    return baseResult(input.definition, input.app, "unavailable", {
      numerator,
      denominator,
      detail: `${input.metricLabel} linked outcomes exceeded starts; the rate is unavailable.`,
    });
  }
  return thresholdResult(input.definition, {
    app: input.app,
    n: denominator,
    value: denominator ? numerator / denominator : null,
    numerator,
    denominator,
    detail: `${numerator} linked ${input.metricLabel} outcomes / ${denominator} starts in the selected day.`,
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

export function createEventChecks(
  rows: QueryRow[],
  funnelRows: QueryRow[],
  troubleRows: QueryRow[],
  uploadRows: QueryRow[],
  issueRows: QueryRow[],
  targetDate: string,
  funnelCohortDate: string,
  targetHour: string,
  window: "hourly" | "daily",
  campaign?: CampaignFollowupResult,
  campaignUnavailableDetail?: string,
): {
  checks: RadarCheckResult[];
  annotations: Array<{ app: string; campaigns: string[] }>;
  issues: RadarWatchRun["issues"];
  sourceCoverage: RadarWatchRun["coverage"]["eventSourceCoverage"];
} {
  const checks: RadarCheckResult[] = [];
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
  const coveragePeriod = window === "hourly" ? targetHour : targetDate;
  for (const app of ["design", "slides", "clips"] as const) {
    if (
      !rows.some(
        (row) =>
          String(row.app) === app && periodMatches(row, coveragePeriod, window),
      )
    ) {
      checks.push(
        baseResult(eventCoverageDefinition, app, "unavailable", {
          detail: `No event rows were readable for ${app} in the selected ${window} period.`,
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
  checks.push(
    linkedDailyRateCheck({
      rows,
      definition: failureDef,
      targetDate,
      app: "slides",
      startEvent: "generation_started",
      denominatorField: "linked_slides_started_users",
      numeratorField: "linked_slides_failed_started_users",
      unlinkedField: "linked_slides_unlinked_events",
      metricLabel: "Slides generation",
    }),
  );

  const designDef = requireCheckDefinition("design-prompt-output");
  checks.push(
    linkedDailyRateCheck({
      rows,
      definition: designDef,
      targetDate,
      app: "design",
      startEvent: "design_prompt_submitted",
      denominatorField: "users",
      numeratorField: "linked_design_prompt_output_users",
      unlinkedField: "linked_design_unlinked_events",
      metricLabel: "Design prompt-to-output",
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
  checks.push(
    linkedDailyRateCheck({
      rows,
      definition: clipsDef,
      targetDate,
      app: "clips",
      startEvent: "recording_started",
      denominatorField: "linked_clips_started_attempts",
      numeratorField: "linked_clips_ready_attempts",
      unlinkedField: "linked_clips_unlinked_events",
      metricLabel: "Clips recording",
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

  for (const row of uploadRows) {
    const result = uploadRejectionCheck(row);
    if (result) checks.push(result);
  }

  const funnelDef = requireCheckDefinition("first-touch-funnel-drop");
  const funnelPeriodDays = Array.from({ length: 7 }, (_, index) =>
    addDays(funnelCohortDate, -(index + 1)),
  );
  const funnelStages = [
    { key: "signup-to-onboarding", parent: "signups", child: "completed" },
    { key: "onboarding-to-app-entry", parent: "completed", child: "entered" },
    { key: "app-entry-to-first-run", parent: "entered", child: "prompted" },
    { key: "first-run-to-output", parent: "prompted", child: "output" },
  ] as const;
  for (const app of ["design", "slides", "clips"]) {
    const target = funnelRows.find(
      (row) =>
        asDate(row.signup_date) === funnelCohortDate &&
        String(row.app) === app &&
        String(row.journey_type) ===
          (app === "design" ? "design_web" : "first_touch"),
    );
    for (const stage of funnelStages) {
      const numerator = numeric(target, stage.child);
      const denominator = numeric(target, stage.parent);
      const baselineRows = funnelPeriodDays.map((date) =>
        funnelRows.find(
          (row) =>
            asDate(row.signup_date) === date &&
            String(row.app) === app &&
            String(row.journey_type) ===
              (app === "design" ? "design_web" : "first_touch"),
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
        minWentToZeroN: EVENT_WENT_TO_ZERO_MIN_N,
      });
      if (change === "first_seen") {
        checks.push(
          baseResult(eventDef, app, "fired", {
            value: currentCount,
            numerator: currentCount,
            detail: `${safeRadarEventLabel(eventName)} was first seen in the 30 day window (${currentCount} events).`,
          }),
        );
      } else if (change === "went_to_zero") {
        checks.push(
          baseResult(eventDef, app, "fired", {
            value: 0,
            baseline: previous / 7,
            numerator: 0,
            detail: `${safeRadarEventLabel(eventName)} had ${previous} events in the previous seven days and none on ${targetDate}.`,
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
  } else if (campaignUnavailableDetail) {
    checks.push(campaignUnavailableCheck(campaignUnavailableDetail));
  }

  return { checks, annotations, issues, sourceCoverage };
}

export async function runWatch(
  options: RadarWatchOptions = {},
): Promise<RadarWatchRun> {
  const window = options.window ?? "daily";
  const cutoff = options.cutoff ?? new Date();
  const currentHour = new Date(cutoff.getTime() - 60 * 60 * 1000);
  currentHour.setUTCMinutes(0, 0, 0);
  const date =
    options.date ??
    (window === "daily"
      ? addDays(cutoff.toISOString().slice(0, 10), -1)
      : currentHour.toISOString().slice(0, 10));
  if (!validDate(date))
    throw new RadarQueryError("--date must be YYYY-MM-DD.", 2);
  const hour = options.hour ?? currentHour.getUTCHours();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RadarQueryError("--hour must be between 0 and 23 UTC.", 2);
  }
  const hourKey = `${date}T${String(hour).padStart(2, "0")}`;
  const funnelCohortDate = matureFunnelCohortDate(date, cutoff);
  const orgId = await resolveRadarOrganizationId();
  const backend = await resolveRadarFirstPartyBackend();
  if (options.prefetched && backend.sink !== "bigquery") {
    throw new RadarQueryError(
      "Prefetched warehouse rows require the BigQuery event backend.",
      2,
    );
  }
  const eventStart = addDays(date, window === "daily" ? -30 : -14);
  const eventBucket = window === "hourly" ? "HOUR" : "DAY";
  let eventRowsData: QueryRow[];
  if (options.prefetched) {
    eventRowsData = options.prefetched.eventRows as QueryRow[];
  } else {
    const eventStatsSql =
      backend.sink === "bigquery"
        ? buildBigQueryEventStatsSql(
            await resolveRadarBigQueryEventsTable(),
            eventBucket,
          )
        : buildEventStatsSql();
    const eventQuerySql =
      window === "daily"
        ? addLinkedEventMetricsSql(
            eventStatsSql,
            backend.sink === "bigquery" ? "bigquery" : "postgres",
            eventBucket,
          )
        : eventStatsSql;
    const eventResult =
      backend.sink === "bigquery"
        ? await runBigQuery(eventQuerySql, {
            params: [
              { name: "start_date", type: "DATE", value: eventStart },
              { name: "end_date", type: "DATE", value: date },
              { name: "org_id", type: "STRING", value: orgId },
            ],
          })
        : await runPostgresQuery(eventQuerySql, [
            eventStart,
            date,
            orgId,
            window === "hourly" ? "hour" : "day",
          ]);
    eventRowsData = eventResult.rows as QueryRow[];
  }
  const queryCount = options.prefetched ? 2 : 3;
  let funnelRows: QueryRow[] = [];
  let troubleRows: QueryRow[] = [];
  let uploadRows: QueryRow[] = [];
  let issueRows: QueryRow[] = [];
  let sloRows: QueryRow[] = [];
  let campaign: CampaignFollowupResult | undefined;
  let campaignUnavailableDetail: string | undefined;
  let additionalQueries = 0;

  if (window === "daily") {
    const funnelStart = addDays(funnelCohortDate, -8);
    const funnelEnd = addDays(funnelCohortDate, 1);
    const funnelCutoff = cutoff.toISOString();
    const [funnel, trouble, upload, issues, slo] = await Promise.all([
      options.prefetched
        ? Promise.resolve({ rows: options.prefetched.funnelRows })
        : backend.sink === "bigquery"
          ? runBigQuery(
              buildBigQueryFunnelDailySql(
                await resolveRadarBigQueryEventsTable(),
              ),
              {
                params: [
                  { name: "start_date", type: "DATE", value: funnelStart },
                  { name: "end_date", type: "DATE", value: funnelEnd },
                  { name: "org_id", type: "STRING", value: orgId },
                  { name: "cutoff", type: "TIMESTAMP", value: funnelCutoff },
                ],
              },
            )
          : runPostgresQuery(buildFunnelDailySql(), [
              funnelStart,
              funnelEnd,
              orgId,
              funnelCutoff,
            ]),
      runPostgresQuery(buildTroubleSql(), [date, date, orgId]),
      loadUploadRejectionRows(
        backend,
        date,
        orgId,
        options.prefetched?.uploadRows as QueryRow[] | undefined,
      ),
      runPostgresQuery(buildErrorIssuesSql(), [
        orgId,
        `${date}T00:00:00.000Z`,
        `${addDays(date, 1)}T00:00:00.000Z`,
      ]),
      options.prefetched
        ? Promise.resolve({ rows: options.prefetched.sloRows })
        : backend.sink === "bigquery"
          ? runBigQuery(
              buildBigQueryPromptOutputSloSql(
                await resolveRadarBigQueryEventsTable(),
              ),
              {
                params: [
                  {
                    name: "start_date",
                    type: "DATE",
                    value: addDays(date, -6),
                  },
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
    uploadRows = upload;
    issueRows = issues.rows as QueryRow[];
    sloRows = slo.rows as QueryRow[];
    additionalQueries = options.prefetched
      ? 2 + 1
      : 5 + (backend.sink === "bigquery" ? 1 : 0);
    if (options.includeCampaign !== false) {
      additionalQueries += 1;
      try {
        campaign = await runCampaignFollowup(orgId);
      } catch (error) {
        campaignUnavailableDetail =
          error instanceof RadarQueryError
            ? error.message
            : "Campaign query failed.";
      }
    }
  }

  const evaluated = createEventChecks(
    eventRowsData,
    funnelRows,
    troubleRows,
    uploadRows,
    issueRows,
    date,
    funnelCohortDate,
    hourKey,
    window,
    campaign,
    campaignUnavailableDetail,
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
  const journeyRows = funnelRows
    .filter(
      (row) =>
        asDate(row.signup_date) === funnelCohortDate &&
        ((row.journey_type === "design_web" && row.app === "design") ||
          row.journey_type === "design_mcp" ||
          (row.journey_type === "first_touch" && row.app === "clips")),
    )
    .map((row) => ({
      ...row,
      app: String(row.app),
      journey_type: String(row.journey_type),
    }));
  return {
    generatedAt: new Date().toISOString(),
    window,
    date,
    ...(window === "hourly" ? { hour } : {}),
    exitCode,
    checks: evaluated.checks,
    journeyRows,
    ...(campaign ? { campaignFollowup: campaign } : {}),
    campaignAnnotations: evaluated.annotations,
    issues: evaluated.issues,
    coverage: {
      eventSourceCoverage: evaluated.sourceCoverage,
      ...(window === "daily" ? { funnelCohortDate } : {}),
      ...(campaign
        ? {
            campaignRecipients: campaign.sentRecipients,
            campaignSkippedRows: campaign.skippedRows,
          }
        : {}),
      ...(window === "daily" && options.includeCampaign !== false
        ? { campaignFollowupAvailable: campaign !== undefined }
        : {}),
    },
    queryCount: queryCount + additionalQueries,
  };
}

function privateOutputDirectory(directory: string): void {
  ensureRadarPrivateDirectory(directory);
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
    ...(run.coverage.funnelCohortDate
      ? [`Funnel signup cohort date: ${run.coverage.funnelCohortDate} UTC.`]
      : []),
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
  lines.push("", "## First-touch journeys", "");
  if (run.window === "hourly") {
    lines.push("Journey funnels are included in daily watch runs.");
  } else {
    const designWeb = run.journeyRows.find(
      (row) => row.journey_type === "design_web",
    );
    const designMcp = run.journeyRows.find(
      (row) => row.journey_type === "design_mcp",
    );
    const clips = run.journeyRows.find(
      (row) => row.journey_type === "first_touch" && row.app === "clips",
    );
    lines.push(
      `- Design web: ${numeric(designWeb, "signups")} signups → ${numeric(designWeb, "completed")} onboarding completed → ${numeric(designWeb, "entered")} app entered → ${numeric(designWeb, "prompted")} prompted → ${numeric(designWeb, "output")} ready output.`,
      `- Design MCP: ${numeric(designMcp, "signups")} signups → ${numeric(designMcp, "completed")} agent connected → ${numeric(designMcp, "entered")} first tool call → ${numeric(designMcp, "output")} design created.`,
      `- Clips activation: ${numeric(clips, "clips_activated_24h")}/${numeric(clips, "signups")} signups reached recording_ready within 24 hours.`,
      "- Clips definition break: 2026-10-21; recording_started before this date included local-only recordings, so compare activation by recording_ready instead.",
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
      "Recipient-level matching uses identified email fields. Anonymous landings cannot be assigned to a recipient.",
      "",
      "| Period | Activity app | Recipients | Any visit | UTM landing | Builder connect | First output |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
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

export function parseWatchArgs(args: readonly string[]): RadarWatchOptions {
  let window: "hourly" | "daily" = "daily";
  let date: string | undefined;
  let hour: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--window") {
      const value = requiredRadarCliValue(args, index, "--window");
      if (value !== "hourly" && value !== "daily")
        throw new RadarQueryError("--window must be hourly or daily.", 2);
      window = value;
      index += 1;
    } else if (args[index] === "--date") {
      date = requiredRadarCliValue(args, index, "--date");
      index += 1;
    } else if (args[index] === "--hour") {
      hour = Number(requiredRadarCliValue(args, index, "--hour"));
      index += 1;
    } else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  return {
    window,
    ...(date !== undefined ? { date } : {}),
    ...(hour !== undefined ? { hour } : {}),
  };
}

async function main(): Promise<void> {
  try {
    const run = await runWatch(parseWatchArgs(process.argv.slice(2)));
    const paths = await writeWatchRun(run);
    console.log(formatWatchMarkdown(run));
    console.log(JSON.stringify({ ...paths, exitCode: run.exitCode }));
    process.exitCode = run.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Radar watch could not run.";
    console.error(message);
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
