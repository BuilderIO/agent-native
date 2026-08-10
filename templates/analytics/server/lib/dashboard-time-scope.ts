import type { DashboardTimeScope } from "../../app/pages/adhoc/sql-dashboard/types";

export const DASHBOARD_TIME_SCOPES: readonly DashboardTimeScope[] = [
  "dashboard",
  "fixed-window",
  "cohort-history",
  "all-time",
];

type DashboardFilterLike = {
  id?: unknown;
  key?: unknown;
  type?: unknown;
  default?: unknown;
};

export type DashboardPanelLike = {
  id?: unknown;
  title?: unknown;
  chartType?: unknown;
  source?: unknown;
  sql?: unknown;
  config?: unknown;
};

type DashboardConfigLike = {
  filters?: unknown;
};

const TEMPORAL_VARIABLE_RE = /\{\{(timeRange|[A-Za-z_]\w*(?:Start|End))\}\}/g;

/** Return the time variables a panel actually references. */
export function extractDashboardTimeVariables(sql: string): string[] {
  const variables = new Set<string>();
  for (const match of sql.matchAll(TEMPORAL_VARIABLE_RE)) {
    variables.add(match[1]);
  }
  return [...variables];
}

function filterId(filter: DashboardFilterLike): string {
  const value = filter.id ?? filter.key;
  return typeof value === "string" ? value.trim() : "";
}

function filtersFrom(config: DashboardConfigLike): DashboardFilterLike[] {
  return Array.isArray(config.filters)
    ? (config.filters as DashboardFilterLike[])
    : [];
}

function panelConfig(panel: DashboardPanelLike): Record<string, unknown> {
  return panel.config && typeof panel.config === "object"
    ? (panel.config as Record<string, unknown>)
    : {};
}

function hasExplicitLowerBound(sql: string): boolean {
  // This intentionally recognizes the bounded shapes used by the shipped
  // first-party catalog. It is a compatibility escape hatch for fixed-window
  // catalog metrics; new ad-hoc panels should use a dashboard placeholder.
  return /\b(?:event_date|timestamp|started_at|ended_at|cohort_date|created_at|date)\b[\s\S]{0,100}?(?:>=|>)\s*[\s\S]{0,160}?(?:CURRENT_DATE|CURRENT_TIMESTAMP|NOW\s*\(|INTERVAL\s*['"]|DATE\s*['"]|TIMESTAMP\s*['"]|\b20\d{2}-\d{2}-\d{2}\b)/i.test(
    sql,
  );
}

const ANALYTICS_SCAN_RE = /\b(?:FROM|JOIN)\s+analytics_events\b/gi;
const TOP_LEVEL_CTE_HEAD_RE = /^\s*WITH\b/i;
const CTE_NAME_RE =
  /^\s*((?:[A-Za-z_]\w*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]))\s*(?:\([^)]*\)\s*)?AS\s*(?:(?:NOT\s+)?MATERIALIZED\s*)?\(/i;

type TopLevelCte = { name: string; bodyStart: number; bodyEnd: number };

type TopLevelCteParse = {
  ctes: TopLevelCte[];
  outerQueryStart: number;
};

function findClosingParenthesis(sql: string, bodyStart: number): number {
  let depth = 1;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = bodyStart; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function skipSqlTrivia(sql: string, start: number): number {
  let i = start;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i += 1;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return sql.length;
      i = end + 2;
      continue;
    }
    break;
  }
  return i;
}

function splitTopLevelUnionBranches(sql: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;

    const union = /^UNION\b/i.exec(sql.slice(i));
    if (!union) continue;
    branches.push(sql.slice(start, i));
    start = skipSqlTrivia(sql, i + union[0].length);
    const modifier = /^(?:ALL|DISTINCT)\b/i.exec(sql.slice(start));
    if (modifier) start = skipSqlTrivia(sql, start + modifier[0].length);
    i = start - 1;
  }

  branches.push(sql.slice(start));
  return branches;
}

/** One top-level `name AS (...)` common-table-expression's body span. */
function topLevelCtes(sql: string): TopLevelCteParse | null {
  const sqlStart = skipSqlTrivia(sql, 0);
  const head = TOP_LEVEL_CTE_HEAD_RE.exec(sql.slice(sqlStart));
  if (!head) return null;
  const ctes: TopLevelCte[] = [];
  let i = skipSqlTrivia(sql, sqlStart + head[0].length);
  const recursive = /^RECURSIVE\b/i.exec(sql.slice(i));
  if (recursive) i = skipSqlTrivia(sql, i + recursive[0].length);
  while (i < sql.length) {
    const nameMatch = CTE_NAME_RE.exec(sql.slice(i));
    if (!nameMatch) return null;
    const name = nameMatch[1];
    const bodyStart = i + nameMatch[0].length;
    const bodyEnd = findClosingParenthesis(sql, bodyStart);
    if (bodyEnd === -1) return null;
    ctes.push({ name, bodyStart, bodyEnd });
    const k = skipSqlTrivia(sql, bodyEnd + 1);
    if (sql[k] === ",") {
      i = k + 1;
      continue;
    }
    return { ctes, outerQueryStart: k };
  }
  return null;
}

function hasAnyTimeBound(text: string): boolean {
  // .search() ignores the shared global-flagged regex's lastIndex state,
  // unlike .test(), which would otherwise give wrong results across calls.
  return (
    text.search(TEMPORAL_VARIABLE_RE) !== -1 || hasExplicitLowerBound(text)
  );
}

/**
 * True if every `analytics_events` scan in `sql` has its own time bound.
 *
 * `hasExplicitLowerBound`/time-variable checks used to run against the whole
 * SQL string: a multi-CTE panel with a bound ANYWHERE (e.g. only on the
 * final SELECT, or only on one of several sibling CTEs) passed validation
 * even though an earlier, unbounded sibling CTE still did a full-table scan
 * — the exact shape of several production incidents (2026-07-25 org-wide
 * audit). This only tightens the check for that specific shape: sibling
 * top-level CTEs each need their own bound. It deliberately does NOT require
 * every nested subquery to be independently bounded — a correlated lookup
 * nested inside an already-bounded outer query (e.g. "has this id EVER
 * appeared as a referrer") is a legitimate, intentionally all-time pattern,
 * and over-flagging it would make this check untrustworthy.
 */
function everyScanIsBounded(sql: string): boolean {
  const parsed = topLevelCtes(sql);
  if (!parsed) {
    // A WITH query that we cannot parse must fail closed. Falling back to a
    // whole-query bound lets a bounded sibling hide an unbounded CTE.
    if (TOP_LEVEL_CTE_HEAD_RE.test(sql.slice(skipSqlTrivia(sql, 0)))) {
      return false;
    }
    return hasAnyTimeBound(sql);
  }
  const units = [
    ...parsed.ctes.map(({ bodyStart, bodyEnd }) =>
      sql.slice(bodyStart, bodyEnd),
    ),
    sql.slice(parsed.outerQueryStart),
  ];
  return units.every((unit) =>
    splitTopLevelUnionBranches(unit).every((branch) => {
      const scans = branch.match(ANALYTICS_SCAN_RE) ?? [];
      if (scans.length === 0) return true;
      // A single lower bound cannot prove that every scan in a join or nested
      // branch is bounded. Fail closed until the SQL has one scan per branch.
      if (scans.length > 1) return false;
      return hasAnyTimeBound(branch);
    }),
  );
}

function hasIntentionalHistoryDescription(
  panel: DashboardPanelLike,
  config: Record<string, unknown>,
): boolean {
  const values = [panel.title, config.description].filter(
    (value): value is string => typeof value === "string",
  );
  return /all[- ]?time|lifetime|histor(?:y|ical)/i.test(values.join(" "));
}

function scopeValue(panel: DashboardPanelLike): DashboardTimeScope | undefined {
  const value = panelConfig(panel).timeScope;
  return typeof value === "string" &&
    (DASHBOARD_TIME_SCOPES as readonly string[]).includes(value)
    ? (value as DashboardTimeScope)
    : undefined;
}

/**
 * Validate the temporal contract for a first-party dashboard panel.
 *
 * Ordinary panels must bind to a dashboard filter. Intentional exceptions are
 * explicit in `config.timeScope`, while legacy fixed-window catalog SQL is
 * accepted when its lower bound is visible in the SQL itself.
 */
export function validateFirstPartyDashboardTimeScope(
  panel: DashboardPanelLike,
  dashboard: DashboardConfigLike,
  index: number,
): string | null {
  if (panel.source !== "first-party") return null;
  if (panel.chartType === "section" || panel.chartType === "extension") {
    return null;
  }

  const sql = typeof panel.sql === "string" ? panel.sql : "";
  const variables = extractDashboardTimeVariables(sql);
  const filters = filtersFrom(dashboard);
  const label =
    typeof panel.title === "string" && panel.title.trim()
      ? `"${panel.title}"`
      : `at index ${index}`;

  for (const variable of variables) {
    const expectedFilterId =
      variable === "timeRange"
        ? "timeRange"
        : variable.replace(/(?:Start|End)$/, "");
    const filter = filters.find(
      (candidate) => filterId(candidate) === expectedFilterId,
    );
    if (!filter) {
      return `panel[${index}] ${label} uses {{${variable}}} but config.filters has no matching "${expectedFilterId}" filter; bind first-party SQL to a declared dashboard time filter`;
    }
    if (variable === "timeRange") {
      if (filter.type !== "select") {
        return `panel[${index}] ${label} uses {{timeRange}}, but filter "timeRange" must have type "select"`;
      }
    } else if (filter.type !== "date-range") {
      return `panel[${index}] ${label} uses {{${variable}}}, but filter "${expectedFilterId}" must have type "date-range"`;
    }
    if (typeof filter.default !== "string" || !filter.default.trim()) {
      return `panel[${index}] ${label} uses a time filter without a non-empty default; choose a bounded default such as "90d" so missing filter state cannot become all-time`;
    }
  }

  const configuredScope = panelConfig(panel).timeScope;
  if (
    configuredScope !== undefined &&
    (typeof configuredScope !== "string" ||
      !(DASHBOARD_TIME_SCOPES as readonly string[]).includes(configuredScope))
  ) {
    return `panel[${index}] ${label} config.timeScope must be one of ${DASHBOARD_TIME_SCOPES.join(", ")}`;
  }

  const scope = scopeValue(panel);
  const hasDashboardBinding = variables.length > 0;
  const hasLowerBound = hasExplicitLowerBound(sql);

  if (scope === "dashboard" && !hasDashboardBinding) {
    return `panel[${index}] ${label} declares timeScope "dashboard" but does not reference {{timeRange}} or a date-range variable`;
  }
  if (scope === "fixed-window" && hasDashboardBinding) {
    return `panel[${index}] ${label} declares timeScope "fixed-window" but uses dashboard time variables; use timeScope "dashboard" or remove the placeholders`;
  }
  if (scope === "fixed-window" && !hasLowerBound) {
    return `panel[${index}] ${label} declares timeScope "fixed-window" without a recognizable lower date bound`;
  }
  if (scope === "all-time" && hasDashboardBinding) {
    return `panel[${index}] ${label} declares timeScope "all-time" but uses dashboard time variables; use timeScope "dashboard" for filter-bound output`;
  }
  if (
    scope === "all-time" &&
    !hasIntentionalHistoryDescription(panel, panelConfig(panel))
  ) {
    return `panel[${index}] ${label} declares timeScope "all-time"; add a description or title that says lifetime, historical, or all-time so the exception is explicit`;
  }

  if (!scope && !hasDashboardBinding && !hasLowerBound) {
    return `panel[${index}] ${label} reads first-party analytics without a time bound; use {{timeRange}} with a non-empty default filter, or explicitly set config.timeScope to "cohort-history" or "all-time" for intentional history scans`;
  }

  // A bound anywhere in the SQL text (checked above) is not the same as
  // every CTE/subquery that reads analytics_events having its own bound — a
  // multi-CTE panel can look bound overall while an earlier CTE still does a
  // full-table scan. Skip this for "all-time" and "cohort-history": both are
  // explicit escape hatches, and a cohort-defining CTE (e.g. "first ever
  // active date per user") is legitimately unbounded by design.
  if (
    scope !== "all-time" &&
    scope !== "cohort-history" &&
    !everyScanIsBounded(sql)
  ) {
    return `panel[${index}] ${label} has at least one analytics_events read (in a CTE or subquery) without its own time bound — a {{timeRange}} reference or literal bound elsewhere in the SQL does not cover it; add a bound to every analytics_events scan, or set config.timeScope to "all-time" for an intentional full-history scan`;
  }

  return null;
}
