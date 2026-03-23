import { useMetricsQuery } from "@/lib/query-metrics";
import { ENRICHED_PROPERTY_MAP } from "./types";

const DYNAMIC_EVENTS_SQL = `SELECT
  event,
  COUNT(*) as cnt
FROM \`your-gcp-project-id.analytics.events_partitioned\`
WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
  AND event IS NOT NULL AND event != ''
GROUP BY event
ORDER BY cnt DESC
LIMIT 300`;

const DYNAMIC_EVENT_NAMES_SQL = `SELECT
  name,
  COUNT(*) as cnt
FROM \`your-gcp-project-id.analytics.events_partitioned\`
WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
  AND name IS NOT NULL AND name != ''
GROUP BY name
ORDER BY cnt DESC
LIMIT 200`;

/**
 * Extract JSON keys from the data column using JSON_EXTRACT_KEYS.
 * Samples a small number of recent rows to discover property names.
 */
const DYNAMIC_PROPERTIES_SQL = `
WITH sampled AS (
  SELECT SAFE.PARSE_JSON(data) AS js
  FROM \`your-gcp-project-id.analytics.events_partitioned\`
  WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    AND createdDate <= CURRENT_TIMESTAMP()
    AND data IS NOT NULL AND SAFE.PARSE_JSON(data) IS NOT NULL
  LIMIT 5000
)
SELECT key, COUNT(*) as cnt
FROM sampled, UNNEST(JSON_EXTRACT_KEYS(js)) AS key
GROUP BY key
HAVING cnt > 2
ORDER BY cnt DESC
LIMIT 300`;

export interface DynamicEvent {
  value: string;
  label: string;
  count: number;
}

export interface DynamicProperty {
  name: string;
  count: number;
}

export interface PropertyValue {
  value: string;
  count: number;
}

/**
 * Hook to load dynamic events from BigQuery.
 * Queries run when `enabled` is true (e.g. when the combobox opens).
 */
export function useDynamicEvents(enabled: boolean) {
  const { data: eventData, isLoading: eventsLoading } = useMetricsQuery(
    ["explorer-dynamic-events"],
    DYNAMIC_EVENTS_SQL,
    { enabled },
  );

  const { data: nameData, isLoading: namesLoading } = useMetricsQuery(
    ["explorer-dynamic-event-names"],
    DYNAMIC_EVENT_NAMES_SQL,
    { enabled },
  );

  const events: DynamicEvent[] = (eventData?.rows ?? []).map((r) => ({
    value: String(r.event),
    label: String(r.event),
    count: Number(r.cnt),
  }));

  const eventNames: DynamicEvent[] = (nameData?.rows ?? []).map((r) => ({
    value: String(r.name),
    label: String(r.name),
    count: Number(r.cnt),
  }));

  return { events, eventNames, isLoading: eventsLoading || namesLoading };
}

/**
 * Hook to load dynamic properties from BigQuery.
 * Always enabled — loads once on mount and caches for 5 min via React Query.
 */
export function useDynamicProperties() {
  const { data, isLoading } = useMetricsQuery(
    ["explorer-dynamic-properties"],
    DYNAMIC_PROPERTIES_SQL,
  );

  const properties: DynamicProperty[] = (data?.rows ?? []).map((r) => ({
    name: String(r.key),
    count: Number(r.cnt),
  }));

  return { properties, isLoading };
}

const TOP_LEVEL_COLS = new Set([
  "event",
  "name",
  "url",
  "type",
  "kind",
  "userId",
  "organizationId",
  "sessionId",
  "browser",
  "modelName",
  "modelId",
  "message",
]);

function escapeSql(s: string): string {
  return s.replace(/'/g, "\\'");
}

function buildPropertyValuesSql(property: string): string {
  // Enriched properties query their own dimension tables (fast, <1s)
  const enriched = ENRICHED_PROPERTY_MAP.get(property);
  if (enriched) return enriched.valuesSql;

  const isTopLevel = TOP_LEVEL_COLS.has(property);
  const col = isTopLevel
    ? property
    : `JSON_VALUE(data, '$.${escapeSql(property)}')`;

  // JSON column scans are expensive (~550GB for 14d) — use 14-day window
  // to stay under 750GB limit. Prefetching makes the wait transparent.
  // Top-level columns are cheap — use 30 days.
  const interval = isTopLevel ? "30 DAY" : "14 DAY";

  return `SELECT ${col} AS val, COUNT(*) AS cnt
FROM \`your-gcp-project-id.analytics.events_partitioned\`
WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${interval})
  AND createdDate <= CURRENT_TIMESTAMP()
  AND ${col} IS NOT NULL AND ${col} != ''
GROUP BY val
ORDER BY cnt DESC
LIMIT 50`;
}

/**
 * Hook to load the top values for a given property.
 * Prefetches immediately when property is set so data is ready
 * when the dropdown opens (BigQuery queries take ~7-9s).
 */
export function usePropertyValues(property: string) {
  const sql = property ? buildPropertyValuesSql(property) : "";
  const { data, isLoading } = useMetricsQuery(
    ["explorer-property-values", property],
    sql,
    { enabled: !!property },
  );

  const values: PropertyValue[] = (data?.rows ?? []).map((r) => ({
    value: String(r.val),
    count: Number(r.cnt),
  }));

  return { values, isLoading, error: data?.error };
}
