import {
  BigQueryMaximumBytesBilledError,
  dryRunQuerySchema,
  runQuery,
} from "../../bigquery.js";
import type { SignupsConfig } from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import { listContentItems } from "../store.js";
import { BUILDER_BLOG_ORIGIN } from "./builder-blog.js";
import { BACKFILL_DAYS, DailyMetricValues, utcDate } from "./daily-metrics.js";

export const SIGNUPS_FIRST_TOUCH_METRIC = "signups_first_touch";
/** The same first-touch signups, only those from the saved `signupSource`. */
export const SOURCE_SIGNUPS_FIRST_TOUCH_METRIC = "signups_first_touch_source";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Far more than any day's article and signup pairs; reaching it is a failure. */
const MAX_ROWS = 200_000;

export type SignupsQuery = {
  sql: string;
  startDate: string;
  endDate: string;
};

type SignupsTables = {
  [K in Exclude<
    keyof SignupsConfig,
    "enabled" | "maxBytesBilled"
  >]: NonNullable<SignupsConfig[K]>;
};

const TABLE_SETTINGS = [
  "signupEventsTable",
  "firstPageviewsTable",
  "signupSource",
  "signupsSince",
] as const;

function notSetUp(missing: readonly string[]): ContentStepStop {
  return new ContentStepStop({
    status: "not_configured",
    errorCode: "signups_not_configured",
    errorMessage: `Per-article signups need ${missing.join(", ")} set with configure-content-collection. Measure maxBytesBilled with estimate-content-signups-cost first.`,
  });
}

/** The warehouse settings the join is built from; a dry run needs only these. */
export function signupsTables(config: SignupsConfig): SignupsTables {
  const missing = TABLE_SETTINGS.filter((key) => config[key] === null);
  if (missing.length > 0) throw notSetUp(missing);
  return config as SignupsTables;
}

/**
 * The approved cap. Without one the step is not set up, so a join nobody has
 * priced never runs.
 */
function signupsCap(config: SignupsConfig): number {
  if (config.maxBytesBilled === null) throw notSetUp(["maxBytesBilled"]);
  return config.maxBytesBilled;
}

/**
 * Signups credited to the blog article each person first landed on, by the
 * day of that first visit: DevRel Leaderboard v3's first-touch join, so a
 * window's daily values add up to its total. A later signup still credits
 * the visit's day, so every run recomputes the whole backfill window.
 *
 * Signups are read only from the window's first day (or `signupsSince`, if
 * later): a signup before the first visit isn't first-touch credit, and a
 * fixed lower bound would grow the scan by a day's events every run.
 *
 * `data_through` is the newest first pageview in the window; days after it
 * aren't in the warehouse yet and get no row.
 */
export function buildSignupsQuery(
  config: SignupsTables,
  now: Date,
): SignupsQuery {
  const end = new Date(now.getTime() - DAY_MS);
  const startDate = utcDate(
    new Date(end.getTime() - (BACKFILL_DAYS - 1) * DAY_MS),
  );
  const endDate = utcDate(end);
  const signupsFrom =
    config.signupsSince > startDate ? config.signupsSince : startDate;
  const blog = new URL(BUILDER_BLOG_ORIGIN);
  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blogPattern = `^https?://(www\\.)?${escapeRegex(blog.hostname.replace(/^www\./, ""))}${escapeRegex(blog.pathname)}`;
  const sql = `WITH signups AS (
  SELECT JSON_VALUE(data, '$.visitorId') AS visitor_id, JSON_VALUE(data, '$.userId') AS user_id, createdDate AS signup_at,
    LOGICAL_OR(JSON_VALUE(data, '$.signupSource') = '${config.signupSource}') AS from_source
  FROM \`${config.signupEventsTable}\`
  WHERE createdDate >= TIMESTAMP('${signupsFrom}') AND event = 'signup'
    AND COALESCE(JSON_VALUE(data, '$.visitorId'), '') != ''
  GROUP BY 1, 2, 3
), visits AS (
  SELECT REGEXP_EXTRACT(url, r'/blog/([^/?#]+)') AS handle, visitor_id, created_date, DATE(created_date) AS day
  FROM \`${config.firstPageviewsTable}\`
  WHERE REGEXP_CONTAINS(url, r'${blogPattern}') AND is_bot = FALSE
    AND created_date >= TIMESTAMP('${startDate}') AND created_date < TIMESTAMP(DATE_ADD(DATE '${endDate}', INTERVAL 1 DAY))
), fresh AS (
  SELECT FORMAT_DATE('%F', MAX(day)) AS data_through FROM visits
), counts AS (
  SELECT v.handle, FORMAT_DATE('%F', v.day) AS day, COUNT(DISTINCT s.user_id) AS signups,
    COUNT(DISTINCT IF(s.from_source, s.user_id, NULL)) AS source_signups
  FROM visits v JOIN signups s ON s.visitor_id = v.visitor_id AND s.signup_at >= v.created_date
  WHERE v.handle IS NOT NULL
  GROUP BY 1, 2
)
SELECT f.data_through, c.handle, c.day, c.signups, c.source_signups FROM fresh f LEFT JOIN counts c ON TRUE`;
  return { sql, startDate, endDate };
}

function costLimited(message: string): ContentStepStop {
  return new ContentStepStop({
    status: "cost_limited",
    errorCode: "signups_bytes_cap",
    errorMessage: message,
  });
}

function articleHandle(url: string | null): string | null {
  if (!url) return null;
  const match = /\/blog\/([^/?#]+)/.exec(url);
  return match ? normalizeHandle(match[1]!) : null;
}

function normalizeHandle(handle: string): string | null {
  try {
    return decodeURIComponent(handle).toLowerCase();
    // coercion-ok: a malformed escape gets the typed null handle, which matches no row
  } catch {
    return null;
  }
}

/** Daily first-touch signups per Builder blog article, behind a bytes cap. */
export const signupsStep: ContentStep = {
  id: "signups",
  async run({ collection, now, signal }) {
    const tables = signupsTables(collection.config.signups);
    const cap = signupsCap(collection.config.signups);
    const articles = await listContentItems(collection, "builder_blog");
    if (articles.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "no_content_items",
        errorMessage:
          "No blog articles are collected yet, so there are no articles to credit signups to.",
      });
    }

    const query = buildSignupsQuery(tables, now);
    const estimate = await dryRunQuerySchema(query.sql, {
      ...(signal ? { signal } : {}),
    });
    if (estimate.error) {
      throw new Error(`The signups dry run failed: ${estimate.error}`);
    }
    if (estimate.totalBytesProcessed === undefined) {
      throw new Error(
        "The signups dry run returned no byte estimate, so the cap can't be checked.",
      );
    }
    if (estimate.totalBytesProcessed > cap) {
      throw costLimited(
        `The signups join would scan ${estimate.totalBytesProcessed} bytes, over the ${cap}-byte cap. Nothing ran.`,
      );
    }

    let result: Awaited<ReturnType<typeof runQuery>>;
    try {
      result = await runQuery(query.sql, {
        maxBytesBilled: cap,
        forceRefresh: true,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof BigQueryMaximumBytesBilledError) {
        throw costLimited(
          `BigQuery stopped the signups join at the ${cap}-byte cap.`,
        );
      }
      throw error;
    }
    if (result.truncated || result.rows.length >= MAX_ROWS) {
      throw new Error(
        `The signups join returned ${result.rows.length} rows, more than this step reads; nothing was written.`,
      );
    }

    const byHandle = new Map(
      articles.flatMap((article) => {
        const handle = articleHandle(article.url);
        return handle ? [[handle, article] as const] : [];
      }),
    );
    const values = new DailyMetricValues();
    let dataThrough: string | null = null;
    for (const row of result.rows) {
      if (typeof row.data_through === "string") dataThrough = row.data_through;
      if (typeof row.handle !== "string" || typeof row.day !== "string") {
        continue;
      }
      const handle = normalizeHandle(row.handle);
      const article = handle ? byHandle.get(handle) : undefined;
      if (!article) continue;
      values.add(
        article,
        row.day,
        SIGNUPS_FIRST_TOUCH_METRIC,
        Number(row.signups),
      );
      values.add(
        article,
        row.day,
        SOURCE_SIGNUPS_FIRST_TOUCH_METRIC,
        Number(row.source_signups),
      );
    }

    const snapshots = values.snapshots({
      items: articles,
      metrics: [SIGNUPS_FIRST_TOUCH_METRIC, SOURCE_SIGNUPS_FIRST_TOUCH_METRIC],
      startDate: query.startDate,
      lastReturnedDate: dataThrough,
    });
    return {
      snapshots,
      outcome: {
        rowCount: snapshots.length,
        windowStart: query.startDate,
        windowEnd: dataThrough,
      },
    };
  },
};
