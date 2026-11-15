import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  NON_PRODUCTION_HOST_PREFIXES,
  NON_PRODUCTION_HOST_SUFFIXES,
  NON_PRODUCTION_HOSTS,
  trafficEnvironmentOfHost,
  type TrafficEnvironment,
} from "../../shared/traffic-environment.js";

const NON_PRODUCTION_PROPERTY_VALUES = [
  "beta",
  "preview",
  "local",
  "development",
  "test",
];

const pgDialect = new PgDialect();

// Usage reads also run in BigQuery, which has no `~*` and binds nothing here, so
// the rule is plain string functions over inlined module constants.
function literal(value: string): SQL {
  return sql.raw(`'${value}'`);
}

function literals(values: readonly string[]): SQL {
  return sql.join(values.map(literal), sql`, `);
}

function nonProductionHost(host: SQL): SQL {
  return sql.join(
    [
      sql`${host} in (${literals(NON_PRODUCTION_HOSTS)})`,
      ...NON_PRODUCTION_HOST_PREFIXES.map(
        (prefix) =>
          sql`left(${host}, ${sql.raw(String(prefix.length))}) = ${literal(prefix)}`,
      ),
      ...NON_PRODUCTION_HOST_SUFFIXES.map(
        (suffix) =>
          sql`right(${host}, ${sql.raw(String(suffix.length))}) = ${literal(suffix)}`,
      ),
    ],
    sql` or `,
  );
}

function recordedHost(host: SQLWrapper): SQL {
  return sql`lower(nullif(${host}, ''))`;
}

const URL_HOST = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#]+)/;

/** `trafficEnvironmentCondition`'s rule, for one row already in hand. */
export function trafficEnvironmentOfRow(
  url: string | null,
  property: string | null,
): TrafficEnvironment {
  const byHost = trafficEnvironmentOfHost(url?.match(URL_HOST)?.[1]);
  if (byHost) return byHost;
  return NON_PRODUCTION_PROPERTY_VALUES.includes(property?.toLowerCase() ?? "")
    ? "beta"
    : "production";
}

/** The host of an absolute URL column; null for a relative or empty one. */
export function urlHostSql(url: SQLWrapper): SQL {
  return sql`substring(${url} from '^[a-zA-Z][a-zA-Z0-9+.-]*://(\\[[^]]+\\]|[^/:?#]+)')`;
}

/**
 * Rows of one kind of traffic. The host decides; a row with no host counts as
 * production unless its own environment property says otherwise.
 */
export function trafficEnvironmentCondition(
  environment: TrafficEnvironment,
  columns: { host: SQLWrapper; property?: SQLWrapper },
): SQL {
  const host = recordedHost(columns.host);
  const byHost = sql`coalesce(${nonProductionHost(host)}, false)`;
  const nonProduction = columns.property
    ? sql`(${byHost} or (${host} is null and coalesce(lower(${columns.property}) in (${literals(NON_PRODUCTION_PROPERTY_VALUES)}), false)))`
    : byHost;
  return environment === "beta" ? nonProduction : sql`not ${nonProduction}`;
}

/**
 * Rows counted as production only because nothing says otherwise: no host, and
 * no environment property that names a known environment.
 */
export function unknownTrafficCondition(columns: {
  host: SQLWrapper;
  property: SQLWrapper;
}): SQL {
  const known = [...NON_PRODUCTION_PROPERTY_VALUES, "production"];
  return sql`(${recordedHost(columns.host)} is null and not coalesce(lower(${columns.property}) in (${literals(known)}), false))`;
}

/** A condition as SQL text, for scoped sources written as strings. */
export function trafficConditionText(condition: SQL): string {
  const { sql: text, params } = pgDialect.sqlToQuery(condition);
  if (params.length > 0) {
    throw new Error("A traffic condition must not bind values");
  }
  return text;
}

export const ANALYTICS_EVENT_TRAFFIC_COLUMNS = {
  host: sql.raw("hostname"),
  property: sql.raw("properties::jsonb ->> 'deployment_environment'"),
};

/** Excludes `http.response`, so the events model can answer it. */
export function trafficCountsSql(since: string): string {
  const count = (condition: SQL) =>
    `SUM(CASE WHEN ${trafficConditionText(condition)} THEN 1 ELSE 0 END)`;
  const production = count(
    trafficEnvironmentCondition("production", ANALYTICS_EVENT_TRAFFIC_COLUMNS),
  );
  const beta = count(
    trafficEnvironmentCondition("beta", ANALYTICS_EVENT_TRAFFIC_COLUMNS),
  );
  const unknown = count(
    unknownTrafficCondition(ANALYTICS_EVENT_TRAFFIC_COLUMNS),
  );
  return `SELECT ${production} AS production_events, ${beta} AS beta_events, ${unknown} AS unknown_events FROM analytics_events WHERE event_date >= '${since}' AND event_name <> 'http.response'`;
}

export function readTrafficCounts(rows: Array<Record<string, unknown>>): {
  production: number;
  beta: number;
  unknown: number;
} {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row) throw new Error("Traffic counts did not return one row");
  // SUM over no rows is null, which is a real zero. Anything else unreadable,
  // a missing field included, fails rather than showing as no unknown traffic.
  const read = (name: string) => {
    const raw = row[name];
    const value = raw === null ? 0 : Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Traffic counts returned an unreadable ${name}`);
    }
    return value;
  };
  return {
    production: read("production_events"),
    beta: read("beta_events"),
    unknown: read("unknown_events"),
  };
}

export const SESSION_RECORDING_TRAFFIC_COLUMNS = {
  host: sql.raw("hostname"),
};
