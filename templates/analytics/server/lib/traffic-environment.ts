import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

import {
  NON_PRODUCTION_HOST_PATTERN,
  type TrafficEnvironment,
} from "../../shared/traffic-environment.js";

const NON_PRODUCTION_PROPERTY_VALUES = [
  "beta",
  "preview",
  "local",
  "development",
  "test",
];

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
  const host = sql`nullif(${columns.host}, '')`;
  const byHost = sql`coalesce(${host} ~* ${NON_PRODUCTION_HOST_PATTERN}, false)`;
  const propertyValues = sql.join(
    NON_PRODUCTION_PROPERTY_VALUES.map((value) => sql`${value}`),
    sql`, `,
  );
  const nonProduction = columns.property
    ? sql`(${byHost} or (${host} is null and coalesce(lower(${columns.property}) in (${propertyValues}), false)))`
    : byHost;
  return environment === "beta" ? nonProduction : sql`not ${nonProduction}`;
}
