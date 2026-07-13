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

type DashboardPanelLike = {
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

  return null;
}
