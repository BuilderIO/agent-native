import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RadarQueryError,
  closeRadarQueries,
  radarRunCliExitCode,
  requiredRadarCliValue,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  resolveRadarOrganizationId,
  runBigQuery,
  runPostgresQuery,
} from "./query.ts";
import { buildFirstTouchEventsCte } from "./sql.ts";
import { bigQueryFirstTouchEventsCte } from "./warehouse-sql.ts";

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  if (index < 0 || index >= items.length) return undefined;
  return items[index];
}

const EXPERIMENT_ID = "first_run_builder_credits";
const DEFAULT_START = "2026-10-19";
const MIN_ARM_SIZE = 30;
const CONFIGURED_VARIANTS = ["control", "credits"] as const;
type ConfiguredVariant = (typeof CONFIGURED_VARIANTS)[number];
const configuredVariantSet = new Set<string>(CONFIGURED_VARIANTS);
const FIRST_TOUCH_APPS = new Set(["design", "slides", "clips"]);
// Downstream events inherit the cohort from exposure; they often omit the variant property.
const AB_CTE = `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3", includeAllApps: true })},
experiment_events AS (
  SELECT person_key, id, event_name, app, happened_at,
    nullif(properties ->> 'experiment_variant', '') AS variant,
    coalesce(properties ->> 'step_id', '') AS step_id,
    coalesce(properties ->> 'method_id', '') AS method_id,
    coalesce(properties ->> 'outcome', '') AS outcome,
    coalesce(properties ->> 'flow', '') AS flow,
    coalesce(properties ->> 'experiment_id', '') AS experiment_id
  FROM base_events
  WHERE event_name = 'onboarding_experiment_exposed'
    AND properties ->> 'experiment_variant' IN ('control', 'credits')
    AND coalesce(properties ->> 'flow', '') = 'first_run'
    AND coalesce(properties ->> 'experiment_id', '') = '${EXPERIMENT_ID}'
    AND happened_at <= $4::timestamptz
),
ranked_exposures AS (
  SELECT person_key, variant, app AS exposure_app, happened_at AS exposed_at,
    row_number() OVER (PARTITION BY person_key ORDER BY happened_at, id) AS exposure_number
  FROM experiment_events
  WHERE event_name = 'onboarding_experiment_exposed' AND step_id = 'choice'
),
exposed AS (
  SELECT person_key, variant, exposure_app, exposed_at
  FROM ranked_exposures WHERE exposure_number = 1
),
flags AS (
  SELECT x.person_key, x.variant, x.exposure_app, x.exposed_at,
    bool_or(e.event_name = 'onboarding_method_outcome'
      AND e.properties ->> 'outcome' IN ('connected', 'already_connected')) AS connected,
    bool_or(e.event_name IN ('builder_connect_succeeded', 'builder connect succeeded')) AS builder_connected,
    bool_or(e.event_name = 'onboarding_completed') AS onboarding_completed,
    bool_or(e.event_name = 'onboarding_app_entered') AS entered_any,
    bool_or(e.event_name IN ('generation_started', 'design_prompt_submitted', 'recording_started')) AS first_run_any,
    bool_or(e.event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')) AS first_output_any,
    x.exposed_at + interval '48 hours'
      <= LEAST($4::timestamptz, ($2::date + 1)::timestamptz) AS d1_mature,
    x.exposed_at + interval '8 days'
      <= LEAST($4::timestamptz, ($2::date + 1)::timestamptz) AS d7_mature,
    bool_or(e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered')
      AND e.happened_at >= x.exposed_at + interval '24 hours'
      AND e.happened_at < x.exposed_at + interval '48 hours') AS d1_return,
    bool_or(e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered')
      AND e.happened_at >= x.exposed_at + interval '7 days'
      AND e.happened_at < x.exposed_at + interval '8 days') AS d7_return
  FROM exposed x
  LEFT JOIN base_events e ON e.person_key = x.person_key
    AND e.happened_at >= x.exposed_at
    AND e.happened_at <= $4::timestamptz
    AND e.event_name <> 'onboarding_experiment_exposed'
  GROUP BY x.person_key, x.variant, x.exposure_app, x.exposed_at
),
app_flags AS (
  SELECT x.person_key, x.variant, x.exposure_app AS app,
    bool_or(e.event_name = 'onboarding_app_entered'
      AND e.app = x.exposure_app) AS entered,
    bool_or(((x.exposure_app = 'slides' AND e.event_name = 'generation_started') OR
      (x.exposure_app = 'design' AND e.event_name = 'design_prompt_submitted') OR
      (x.exposure_app = 'clips' AND e.event_name = 'recording_started'))
      AND e.app = x.exposure_app) AS first_run,
    bool_or(((x.exposure_app = 'slides' AND e.event_name = 'deck_created') OR
      (x.exposure_app = 'design' AND e.event_name = 'design_ready_viewed') OR
      (x.exposure_app = 'clips' AND e.event_name = 'recording_ready'))
      AND e.app = x.exposure_app) AS first_output
  FROM exposed x
  LEFT JOIN base_events e ON e.person_key = x.person_key
    AND e.happened_at >= x.exposed_at
    AND e.happened_at <= $4::timestamptz
    AND e.event_name <> 'onboarding_experiment_exposed'
  GROUP BY x.person_key, x.variant, x.exposure_app
)`;

const AB_SQL = `${AB_CTE}
SELECT variant, 'all'::text AS app, count(*)::int AS exposed,
  count(*) FILTER (WHERE coalesce(connected, false) OR coalesce(builder_connected, false))::int AS connected,
  count(*) FILTER (WHERE coalesce(onboarding_completed, false))::int AS onboarding_completed,
  count(*) FILTER (WHERE coalesce(entered_any, false))::int AS entered,
  count(*) FILTER (WHERE coalesce(first_run_any, false))::int AS first_run,
  count(*) FILTER (WHERE coalesce(first_output_any, false))::int AS first_output,
  count(*) FILTER (WHERE d1_mature)::int AS d1_mature,
  count(*) FILTER (WHERE d1_mature AND coalesce(d1_return, false))::int AS d1_return,
  count(*) FILTER (WHERE d7_mature)::int AS d7_mature,
  count(*) FILTER (WHERE d7_mature AND coalesce(d7_return, false))::int AS d7_return
FROM flags GROUP BY variant
UNION ALL
SELECT variant, app, count(*)::int AS exposed,
  count(*) FILTER (WHERE false)::int AS connected,
  count(*) FILTER (WHERE false)::int AS onboarding_completed,
  count(*) FILTER (WHERE coalesce(entered, false))::int AS entered,
  count(*) FILTER (WHERE coalesce(first_run, false))::int AS first_run,
  count(*) FILTER (WHERE coalesce(first_output, false))::int AS first_output,
  count(*) FILTER (WHERE false)::int AS d1_mature,
  count(*) FILTER (WHERE false)::int AS d1_return,
  count(*) FILTER (WHERE false)::int AS d7_mature,
  count(*) FILTER (WHERE false)::int AS d7_return
FROM app_flags GROUP BY variant, app
ORDER BY variant, app`;

export function buildPostgresAbSql(): string {
  return AB_SQL;
}

export function buildBigQueryAbSql(eventsTableRange: string): string {
  const cte = bigQueryFirstTouchEventsCte(eventsTableRange, {
    includeAllApps: true,
    columns: {
      id: true,
      eventDate: false,
      sessionId: false,
      url: false,
      personKey: true,
      identityEmail: false,
      referralSource: false,
      properties: true,
    },
  });
  return `${cte},
experiment_events AS (
  SELECT person_key, id, event_name, app, happened_at,
    nullif(json_value(properties, '$.experiment_variant'), '') AS variant,
    coalesce(json_value(properties, '$.step_id'), '') AS step_id,
    coalesce(json_value(properties, '$.method_id'), '') AS method_id,
    coalesce(json_value(properties, '$.outcome'), '') AS outcome,
    coalesce(json_value(properties, '$.flow'), '') AS flow,
    coalesce(json_value(properties, '$.experiment_id'), '') AS experiment_id
  FROM base_events
  WHERE event_name = 'onboarding_experiment_exposed'
    AND json_value(properties, '$.experiment_variant') IN ('control', 'credits')
    AND coalesce(json_value(properties, '$.flow'), '') = 'first_run'
    AND coalesce(json_value(properties, '$.experiment_id'), '') = '${EXPERIMENT_ID}'
    AND happened_at <= @as_of
),
ranked_exposures AS (
  SELECT person_key, variant, app AS exposure_app, happened_at AS exposed_at,
    row_number() OVER (PARTITION BY person_key ORDER BY happened_at, id) AS exposure_number
  FROM experiment_events
  WHERE event_name = 'onboarding_experiment_exposed' AND step_id = 'choice'
),
exposed AS (
  SELECT person_key, variant, exposure_app, exposed_at
  FROM ranked_exposures WHERE exposure_number = 1
),
flags AS (
  SELECT x.person_key, x.variant, x.exposure_app, x.exposed_at,
    logical_or(e.event_name = 'onboarding_method_outcome'
      AND json_value(e.properties, '$.outcome') IN ('connected', 'already_connected')) AS connected,
    logical_or(e.event_name IN ('builder_connect_succeeded', 'builder connect succeeded')) AS builder_connected,
    logical_or(e.event_name = 'onboarding_completed') AS onboarding_completed,
    logical_or(e.event_name = 'onboarding_app_entered') AS entered_any,
    logical_or(e.event_name IN ('generation_started', 'design_prompt_submitted', 'recording_started')) AS first_run_any,
    logical_or(e.event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')) AS first_output_any,
    timestamp_add(x.exposed_at, INTERVAL 48 HOUR)
      <= LEAST(@as_of, timestamp(date_add(@end_date, INTERVAL 1 DAY))) AS d1_mature,
    timestamp_add(x.exposed_at, INTERVAL 8 DAY)
      <= LEAST(@as_of, timestamp(date_add(@end_date, INTERVAL 1 DAY))) AS d7_mature,
    logical_or(e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered')
      AND e.happened_at >= timestamp_add(x.exposed_at, INTERVAL 24 HOUR)
      AND e.happened_at < timestamp_add(x.exposed_at, INTERVAL 48 HOUR)) AS d1_return,
    logical_or(e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered')
      AND e.happened_at >= timestamp_add(x.exposed_at, INTERVAL 7 DAY)
      AND e.happened_at < timestamp_add(x.exposed_at, INTERVAL 8 DAY)) AS d7_return
  FROM exposed x
  LEFT JOIN base_events e ON e.person_key = x.person_key
    AND e.happened_at >= x.exposed_at
    AND e.happened_at <= @as_of
    AND e.event_name != 'onboarding_experiment_exposed'
  GROUP BY x.person_key, x.variant, x.exposure_app, x.exposed_at
),
app_flags AS (
  SELECT x.person_key, x.variant, x.exposure_app AS app,
    logical_or(e.event_name = 'onboarding_app_entered'
      AND e.app = x.exposure_app) AS entered,
    logical_or(((x.exposure_app = 'slides' AND e.event_name = 'generation_started') OR
      (x.exposure_app = 'design' AND e.event_name = 'design_prompt_submitted') OR
      (x.exposure_app = 'clips' AND e.event_name = 'recording_started'))
      AND e.app = x.exposure_app) AS first_run,
    logical_or(((x.exposure_app = 'slides' AND e.event_name = 'deck_created') OR
      (x.exposure_app = 'design' AND e.event_name = 'design_ready_viewed') OR
      (x.exposure_app = 'clips' AND e.event_name = 'recording_ready'))
      AND e.app = x.exposure_app) AS first_output
  FROM exposed x
  LEFT JOIN base_events e ON e.person_key = x.person_key
    AND e.happened_at >= x.exposed_at
    AND e.happened_at <= @as_of
    AND e.event_name != 'onboarding_experiment_exposed'
  GROUP BY x.person_key, x.variant, x.exposure_app
)
SELECT variant, 'all' AS app, count(*) AS exposed,
  countif(coalesce(connected, false) OR coalesce(builder_connected, false)) AS connected,
  countif(coalesce(onboarding_completed, false)) AS onboarding_completed,
  countif(coalesce(entered_any, false)) AS entered,
  countif(coalesce(first_run_any, false)) AS first_run,
  countif(coalesce(first_output_any, false)) AS first_output,
  countif(d1_mature) AS d1_mature,
  countif(d1_mature AND coalesce(d1_return, false)) AS d1_return,
  countif(d7_mature) AS d7_mature,
  countif(d7_mature AND coalesce(d7_return, false)) AS d7_return
FROM flags GROUP BY variant
UNION ALL
SELECT variant, app, count(*) AS exposed,
  0 AS connected, 0 AS onboarding_completed,
  countif(coalesce(entered, false)) AS entered,
  countif(coalesce(first_run, false)) AS first_run,
  countif(coalesce(first_output, false)) AS first_output,
  0 AS d1_mature, 0 AS d1_return, 0 AS d7_mature, 0 AS d7_return
FROM app_flags GROUP BY variant, app
ORDER BY variant, app`;
}

export interface AbMetric {
  successes: number;
  total: number;
  rate: number | null;
  ci95: [number, number] | null;
  pValue: number | null;
  enoughData: boolean;
}

export interface AbArmSummary {
  variant: string;
  exposed: number;
  connected: AbMetric;
  onboardingCompleted: AbMetric;
  entered: AbMetric;
  firstRun: AbMetric;
  firstOutput: AbMetric;
  d1Return: AbMetric;
  d7Return: AbMetric;
  apps: Array<{
    app: string;
    exposed: number;
    entered: AbMetric;
    firstRun: AbMetric;
    firstOutput: AbMetric;
    firstRunTracked: boolean;
    firstOutputTracked: boolean;
  }>;
}

export interface AbReadout {
  experiment: string;
  startDate: string;
  endDate: string;
  dataCutoff: string;
  minimumArmSize: number;
  sampleRatioMismatch: { pValue: number; flagged: boolean };
  arms: AbArmSummary[];
  generatedAt: string;
}

export function isConfiguredAbVariant(
  value: unknown,
): value is ConfiguredVariant {
  return typeof value === "string" && configuredVariantSet.has(value);
}

function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989422804014327 * Math.exp(-(absolute * absolute) / 2);
  const tail =
    density *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

export function wilsonInterval(
  successes: number,
  total: number,
): [number, number] | null {
  if (total <= 0) return null;
  const z = 1.959963984540054;
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (rate + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total)) /
    denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function twoProportionPValue(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number,
): number | null {
  if (totalA <= 0 || totalB <= 0) return null;
  const pooled = (successesA + successesB) / (totalA + totalB);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / totalA + 1 / totalB),
  );
  if (standardError === 0) return 1;
  return Math.min(
    1,
    2 *
      (1 -
        normalCdf(
          Math.abs(successesA / totalA - successesB / totalB) / standardError,
        )),
  );
}

export function sampleRatioPValue(control: number, treatment: number): number {
  const total = control + treatment;
  if (total === 0) return 1;
  return Math.min(
    1,
    2 * (1 - normalCdf(Math.abs(control - treatment) / Math.sqrt(total))),
  );
}

function metric(
  successes: number,
  total: number,
  pValue: number | null,
): AbMetric {
  return {
    successes,
    total,
    rate: total ? successes / total : null,
    ci95: wilsonInterval(successes, total),
    pValue,
    enoughData: total >= MIN_ARM_SIZE,
  };
}

function number(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseAsOfTimestamp(value: string): Date | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    ) ||
    !isCalendarDate(value.slice(0, 10))
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export interface AbReadoutOptions {
  experiment?: string;
  startDate?: string;
  endDate?: string;
  asOf?: string;
}

export async function runAbReadout(
  options: AbReadoutOptions = {},
): Promise<AbReadout> {
  const experiment = options.experiment ?? EXPERIMENT_ID;
  if (experiment !== EXPERIMENT_ID) {
    throw new RadarQueryError(
      "Only first_run_builder_credits is configured.",
      2,
    );
  }
  const startDate = options.startDate ?? DEFAULT_START;
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10);
  if (
    !isCalendarDate(startDate) ||
    !isCalendarDate(endDate) ||
    startDate > endDate
  ) {
    throw new RadarQueryError(
      "A valid ordered --start and --end date is required.",
      2,
    );
  }
  const endExclusive = new Date(`${endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const requestedCutoff = options.asOf
    ? parseAsOfTimestamp(options.asOf)
    : endExclusive;
  if (!requestedCutoff)
    throw new RadarQueryError(
      "--as-of must be an ISO timestamp with a valid date and explicit UTC offset.",
      2,
    );
  const cutoffDate = new Date(
    Math.min(requestedCutoff.getTime(), Date.now(), endExclusive.getTime()),
  );
  if (cutoffDate < new Date(`${startDate}T00:00:00.000Z`)) {
    throw new RadarQueryError(
      "The A/B data cutoff must be on or after --start.",
      2,
    );
  }
  const dataCutoff = cutoffDate.toISOString();
  const orgId = await resolveRadarOrganizationId();
  const backend = await resolveRadarFirstPartyBackend();
  const result =
    backend.sink === "bigquery"
      ? await runBigQuery(
          buildBigQueryAbSql(await resolveRadarBigQueryEventsTable()),
          {
            params: [
              { name: "start_date", type: "DATE", value: startDate },
              { name: "end_date", type: "DATE", value: endDate },
              { name: "org_id", type: "STRING", value: orgId },
              { name: "as_of", type: "TIMESTAMP", value: dataCutoff },
            ],
            fresh: true,
            cache: false,
          },
        )
      : await runPostgresQuery(
          buildPostgresAbSql(),
          [startDate, endDate, orgId, dataCutoff],
          {
            fresh: true,
          },
        );
  const { rows } = result;
  if (rows.some((row) => !isConfiguredAbVariant(row.variant))) {
    throw new RadarQueryError(
      "A/B readout returned an unconfigured experiment variant; output was suppressed.",
      1,
    );
  }
  const overall = rows.filter((row) => String(row.app) === "all");
  const appRows = rows.filter((row) => String(row.app) !== "all");
  const variants = [
    ...new Set(overall.map((row) => String(row.variant))),
  ].sort();
  if (
    variants.length !== CONFIGURED_VARIANTS.length ||
    CONFIGURED_VARIANTS.some((variant) => !variants.includes(variant))
  ) {
    throw new RadarQueryError(
      "A/B readout did not return both configured experiment arms.",
      2,
    );
  }
  const counts = new Map(overall.map((row) => [String(row.variant), row]));
  const armSummaries = variants.map((variant): AbArmSummary => {
    const row = counts.get(variant) ?? {};
    const exposed = number(row, "exposed");
    const compare = (key: string, totalKey = "exposed") => {
      if (variants.length !== 2) return null;
      const values = variants.map((name) => {
        const arm = counts.get(name) ?? {};
        return { successes: number(arm, key), total: number(arm, totalKey) };
      });
      const left = itemAt(values, 0);
      const right = itemAt(values, 1);
      if (!left || !right) {
        throw new RadarQueryError(
          "A/B comparison did not produce both experiment arms.",
          1,
        );
      }
      return twoProportionPValue(
        left.successes,
        left.total,
        right.successes,
        right.total,
      );
    };
    const appMetrics = appRows
      .filter((item) => String(item.variant) === variant)
      .map((item) => {
        const app = String(item.app);
        const totals = appRows.filter((other) => String(other.app) === app);
        const pFor = (key: string) => {
          const left =
            totals.find(
              (candidate) => String(candidate.variant) === variants[0],
            ) ?? {};
          const right =
            totals.find(
              (candidate) => String(candidate.variant) === variants[1],
            ) ?? {};
          return twoProportionPValue(
            number(left, key),
            number(left, "exposed"),
            number(right, key),
            number(right, "exposed"),
          );
        };
        const appN = number(item, "exposed");
        const firstRunTracked = FIRST_TOUCH_APPS.has(app);
        const firstOutputTracked = FIRST_TOUCH_APPS.has(app);
        return {
          app,
          exposed: appN,
          entered: metric(number(item, "entered"), appN, pFor("entered")),
          firstRun: firstRunTracked
            ? metric(number(item, "first_run"), appN, pFor("first_run"))
            : metric(0, 0, null),
          firstOutput: firstOutputTracked
            ? metric(number(item, "first_output"), appN, pFor("first_output"))
            : metric(0, 0, null),
          firstRunTracked,
          firstOutputTracked,
        };
      });
    const d1Mature = number(row, "d1_mature");
    const d7Mature = number(row, "d7_mature");
    return {
      variant,
      exposed,
      connected: metric(
        number(row, "connected"),
        exposed,
        compare("connected"),
      ),
      onboardingCompleted: metric(
        number(row, "onboarding_completed"),
        exposed,
        compare("onboarding_completed"),
      ),
      entered: metric(number(row, "entered"), exposed, compare("entered")),
      firstRun: metric(number(row, "first_run"), exposed, compare("first_run")),
      firstOutput: metric(
        number(row, "first_output"),
        exposed,
        compare("first_output"),
      ),
      d1Return: metric(
        number(row, "d1_return"),
        d1Mature,
        compare("d1_return", "d1_mature"),
      ),
      d7Return: metric(
        number(row, "d7_return"),
        d7Mature,
        compare("d7_return", "d7_mature"),
      ),
      apps: appMetrics,
    };
  });
  const control = overall.find((row) => String(row.variant) === "control");
  const treatment = overall.find((row) => String(row.variant) === "credits");
  const controlN = control ? number(control, "exposed") : 0;
  const treatmentN = treatment ? number(treatment, "exposed") : 0;
  const sampleRatioP = sampleRatioPValue(controlN, treatmentN);
  return {
    experiment,
    startDate,
    endDate,
    dataCutoff,
    minimumArmSize: MIN_ARM_SIZE,
    sampleRatioMismatch: {
      pValue: sampleRatioP,
      flagged: sampleRatioP < 0.001,
    },
    arms: armSummaries,
    generatedAt: new Date().toISOString(),
  };
}

function formatRate(value: AbMetric): string {
  if (!value.enoughData || value.rate === null || !value.ci95)
    return "not enough data";
  return `${(value.rate * 100).toFixed(1)}% (95% CI ${(value.ci95[0] * 100).toFixed(1)}–${(value.ci95[1] * 100).toFixed(1)}%; p=${value.pValue?.toFixed(4) ?? "n/a"})`;
}

export function formatAbMarkdown(result: AbReadout): string {
  const lines = [
    `# A/B readout: ${result.experiment}`,
    "",
    `Window: ${result.startDate} through ${result.endDate} (inclusive), data cutoff ${result.dataCutoff}. Minimum arm size: ${result.minimumArmSize}.`,
    `Sample ratio mismatch p=${result.sampleRatioMismatch.pValue.toFixed(4)}; flagged=${result.sampleRatioMismatch.flagged}.`,
    "",
    "| Variant | Exposed | Connected | Onboarding complete | D1 return | D7 return |",
    "| --- | ---: | --- | --- | --- | --- |",
  ];
  for (const arm of result.arms) {
    lines.push(
      `| ${arm.variant} | ${arm.exposed} | ${arm.connected.successes}/${arm.connected.total}; ${formatRate(arm.connected)} | ${arm.onboardingCompleted.successes}/${arm.onboardingCompleted.total}; ${formatRate(arm.onboardingCompleted)} | ${arm.d1Return.successes}/${arm.d1Return.total}; ${formatRate(arm.d1Return)} | ${arm.d7Return.successes}/${arm.d7Return.total}; ${formatRate(arm.d7Return)} |`,
    );
  }
  lines.push(
    "",
    "## Per-app entry, first run, and first output",
    "",
    "| Variant | App | Exposed | Entered | First run | First output |",
    "| --- | --- | ---: | --- | --- | --- |",
  );
  for (const arm of result.arms) {
    for (const app of arm.apps) {
      const firstRun = app.firstRunTracked
        ? `${app.firstRun.successes}/${app.firstRun.total}; ${formatRate(app.firstRun)}`
        : "not tracked";
      const firstOutput = app.firstOutputTracked
        ? `${app.firstOutput.successes}/${app.firstOutput.total}; ${formatRate(app.firstOutput)}`
        : "not tracked";
      lines.push(
        `| ${arm.variant} | ${app.app} | ${app.exposed} | ${app.entered.successes}/${app.entered.total}; ${formatRate(app.entered)} | ${firstRun} | ${firstOutput} |`,
      );
    }
  }
  lines.push(
    "",
    "Downstream activity is assigned to the user's first-exposure variant and counted after exposure. D1 and D7 include only cohorts whose full 48-hour and 8-day observation windows fit inside the data cutoff.",
  );
  return lines.join("\n");
}

export function parseAbReadoutArgs(args: readonly string[]): AbReadoutOptions {
  let experiment: string | undefined;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let asOf: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--experiment") {
      experiment = requiredRadarCliValue(args, index, "--experiment");
      index += 1;
    } else if (args[index] === "--start") {
      startDate = requiredRadarCliValue(args, index, "--start");
      index += 1;
    } else if (args[index] === "--end") {
      endDate = requiredRadarCliValue(args, index, "--end");
      index += 1;
    } else if (args[index] === "--as-of") {
      asOf = requiredRadarCliValue(args, index, "--as-of");
      index += 1;
    } else throw new RadarQueryError(`Unknown argument: ${args[index]}`, 2);
  }
  return {
    ...(experiment !== undefined ? { experiment } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...(asOf !== undefined ? { asOf } : {}),
  };
}

async function main(): Promise<void> {
  try {
    const result = await runAbReadout(
      parseAbReadoutArgs(process.argv.slice(2)),
    );
    console.log(formatAbMarkdown(result));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "A/B readout could not run.",
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
