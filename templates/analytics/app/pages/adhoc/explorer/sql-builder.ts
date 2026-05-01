import type {
  ExplorerConfig,
  ExplorerEvent,
  ExplorerFilter,
  EnrichedProperty,
} from "./types";
import { TOP_LEVEL_COLUMN_SET, ENRICHED_PROPERTY_MAP } from "./types";

const APP_EVENTS = "`@project.analytics.events_partitioned`";

function columnRef(property: string, tableAlias?: string): string {
  const enriched = ENRICHED_PROPERTY_MAP.get(property);
  if (enriched) return enriched.columnExpr;
  const prefix = tableAlias ? `${tableAlias}.` : "";
  if (TOP_LEVEL_COLUMN_SET.has(property)) {
    return `${prefix}${property}`;
  }
  return `JSON_VALUE(${prefix}data, '$.${property}')`;
}

/** Collect all enriched properties used in an event's filters + groupBy */
function collectEnrichedJoins(
  ev: ExplorerEvent,
): Map<string, EnrichedProperty> {
  const joins = new Map<string, EnrichedProperty>();
  for (const f of ev.filters) {
    const ep = ENRICHED_PROPERTY_MAP.get(f.property);
    if (ep) joins.set(ep.joinAlias, ep);
  }
  for (const g of ev.groupBy) {
    const ep = ENRICHED_PROPERTY_MAP.get(g);
    if (ep) joins.set(ep.joinAlias, ep);
  }
  return joins;
}

function collectAllEnrichedJoins(
  events: ExplorerEvent[],
): Map<string, EnrichedProperty> {
  const joins = new Map<string, EnrichedProperty>();
  for (const ev of events) {
    for (const [k, v] of collectEnrichedJoins(ev)) joins.set(k, v);
  }
  return joins;
}

function filterToSql(f: ExplorerFilter, tableAlias?: string): string {
  const col = columnRef(f.property, tableAlias);
  switch (f.operator) {
    case "=":
      return `${col} = '${escapeSql(f.value ?? "")}'`;
    case "!=":
      return `${col} != '${escapeSql(f.value ?? "")}'`;
    case "contains":
      return `${col} LIKE '%${escapeSql(f.value ?? "")}%'`;
    case "not_contains":
      return `${col} NOT LIKE '%${escapeSql(f.value ?? "")}%'`;
    case "is_set":
      return `${col} IS NOT NULL AND ${col} != ''`;
    case "is_not_set":
      return `(${col} IS NULL OR ${col} = '')`;
  }
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "\\'");
}

function dateRangeToDays(range: string): number {
  switch (range) {
    case "7d":
      return 7;
    case "14d":
      return 14;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return 30;
  }
}

function buildEventWhere(ev: ExplorerEvent, tableAlias?: string): string {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const parts: string[] = [`${prefix}event = '${escapeSql(ev.event)}'`];
  for (const f of ev.filters) {
    parts.push(filterToSql(f, tableAlias));
  }
  return parts.join(" AND ");
}

export function buildSql(config: ExplorerConfig): string {
  if (config.events.length === 0) return "";

  const isTimeSeries =
    config.chartType === "line" || config.chartType === "bar";
  const isMetric = config.chartType === "metric";

  // Date range clause
  let dateClause: string;
  if (
    config.dateRange === "custom" &&
    config.customDateStart &&
    config.customDateEnd
  ) {
    dateClause = `createdDate >= TIMESTAMP('${config.customDateStart}') AND createdDate <= TIMESTAMP('${config.customDateEnd}')`;
  } else {
    const days = dateRangeToDays(config.dateRange);
    dateClause = `createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY) AND createdDate <= CURRENT_TIMESTAMP()`;
  }

  // Check if any enriched joins are needed
  const allJoins = collectAllEnrichedJoins(config.events);
  const needsJoin = allJoins.size > 0;
  const alias = needsJoin ? "e" : undefined;

  // Single event case (most common)
  if (config.events.length === 1) {
    const ev = config.events[0];
    return buildSingleEventSql(
      ev,
      dateClause,
      config.chartType,
      needsJoin ? collectEnrichedJoins(ev) : undefined,
    );
  }

  // Multiple events — union or side-by-side
  if (isMetric) {
    return buildMultiMetricSql(config.events, dateClause);
  }

  return buildMultiEventSql(config.events, dateClause, isTimeSeries);
}

function buildSingleEventSql(
  ev: ExplorerEvent,
  dateClause: string,
  chartType: string,
  joins?: Map<string, EnrichedProperty>,
): string {
  const isTimeSeries = chartType === "line" || chartType === "bar";
  const isMetric = chartType === "metric";
  const hasGroupBy = ev.groupBy.length > 0;
  const hasJoins = joins && joins.size > 0;
  const alias = hasJoins ? "e" : undefined;

  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  if (isTimeSeries) {
    selectParts.push(`DATE(${alias ? alias + "." : ""}createdDate) AS date`);
    groupByParts.push("date");
  }

  if (hasGroupBy) {
    for (const g of ev.groupBy) {
      const col = columnRef(g, alias);
      selectParts.push(`${col} AS ${sanitizeAlias(g)}`);
      groupByParts.push(sanitizeAlias(g));
    }
  }

  selectParts.push("COUNT(*) AS count");

  const dateCol = alias ? `${alias}.createdDate` : "createdDate";
  const qualifiedDateClause = dateClause.replace(/createdDate/g, dateCol);
  const whereParts = [qualifiedDateClause, buildEventWhere(ev, alias)];

  const sql = [
    `SELECT ${selectParts.join(", ")}`,
    `FROM ${APP_EVENTS}${alias ? ` ${alias}` : ""}`,
  ];

  // Add JOINs for enriched properties
  if (hasJoins) {
    for (const [, ep] of joins!) {
      sql.push(`LEFT JOIN ${ep.joinTable} ${ep.joinAlias} ON ${ep.joinOn}`);
    }
  }

  sql.push(`WHERE ${whereParts.join(" AND ")}`);

  if (groupByParts.length > 0) {
    sql.push(`GROUP BY ${groupByParts.join(", ")}`);
  }

  if (isTimeSeries) {
    sql.push("ORDER BY date");
  } else if (isMetric) {
    // no order needed
  } else {
    sql.push("ORDER BY count DESC");
    sql.push("LIMIT 100");
  }

  return sql.join("\n");
}

function buildMultiMetricSql(
  events: ExplorerEvent[],
  dateClause: string,
): string {
  const parts = events.map((ev) => {
    const label = ev.label || ev.event;
    const joins = collectEnrichedJoins(ev);
    const hasJoins = joins.size > 0;
    const alias = hasJoins ? "e" : undefined;
    const dateCol = alias ? `${alias}.createdDate` : "createdDate";
    const qualifiedDateClause = dateClause.replace(/createdDate/g, dateCol);
    const where = [qualifiedDateClause, buildEventWhere(ev, alias)].join(
      " AND ",
    );
    let from = `${APP_EVENTS}${alias ? ` ${alias}` : ""}`;
    if (hasJoins) {
      for (const [, ep] of joins) {
        from += ` LEFT JOIN ${ep.joinTable} ${ep.joinAlias} ON ${ep.joinOn}`;
      }
    }
    return `SELECT '${escapeSql(label)}' AS event_label, COUNT(*) AS count FROM ${from} WHERE ${where}`;
  });
  return parts.join("\nUNION ALL\n");
}

function buildMultiEventSql(
  events: ExplorerEvent[],
  dateClause: string,
  isTimeSeries: boolean,
): string {
  const parts = events.map((ev) => {
    const label = ev.label || ev.event;
    const joins = collectEnrichedJoins(ev);
    const hasJoins = joins.size > 0;
    const alias = hasJoins ? "e" : undefined;
    const selectParts: string[] = [`'${escapeSql(label)}' AS event_label`];
    const groupByParts: string[] = [];

    if (isTimeSeries) {
      selectParts.push(`DATE(${alias ? alias + "." : ""}createdDate) AS date`);
      groupByParts.push("date");
    }

    for (const g of ev.groupBy) {
      const col = columnRef(g, alias);
      selectParts.push(`${col} AS ${sanitizeAlias(g)}`);
      groupByParts.push(sanitizeAlias(g));
    }

    selectParts.push("COUNT(*) AS count");

    const dateCol = alias ? `${alias}.createdDate` : "createdDate";
    const qualifiedDateClause = dateClause.replace(/createdDate/g, dateCol);
    const where = [qualifiedDateClause, buildEventWhere(ev, alias)].join(
      " AND ",
    );
    const sql = [
      `SELECT ${selectParts.join(", ")}`,
      `FROM ${APP_EVENTS}${alias ? ` ${alias}` : ""}`,
    ];
    if (hasJoins) {
      for (const [, ep] of joins) {
        sql.push(`LEFT JOIN ${ep.joinTable} ${ep.joinAlias} ON ${ep.joinOn}`);
      }
    }
    sql.push(`WHERE ${where}`);
    if (groupByParts.length > 0) {
      sql.push(`GROUP BY event_label, ${groupByParts.join(", ")}`);
    } else {
      sql.push("GROUP BY event_label");
    }
    return sql.join(" ");
  });

  const union = parts.join("\nUNION ALL\n");

  if (isTimeSeries) {
    return union + "\nORDER BY date";
  }
  return union + "\nORDER BY count DESC\nLIMIT 100";
}

function sanitizeAlias(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}
