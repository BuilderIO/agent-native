function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

export interface InterpolateOptions {
  failClosedTimeVariables?: boolean;
  customDateRangeSupport?: boolean;
}

// ponytail: daily date spines cap custom ranges at roughly ten years; use per-query budgets if wider history becomes a supported need.
const MAX_CUSTOM_DATE_RANGE_DAYS = 3660;
const DAY_MILLISECONDS = 86_400_000;

export function interpolateDashboardPanelSql(
  sql: string | undefined | null,
  vars: Record<string, string>,
  panel: { source?: unknown; config?: unknown },
): string {
  const config =
    typeof panel.config === "object" &&
    panel.config !== null &&
    !Array.isArray(panel.config)
      ? (panel.config as Record<string, unknown>)
      : {};
  return interpolate(sql, vars, {
    failClosedTimeVariables: true,
    customDateRangeSupport:
      (panel.source === "bigquery" || panel.source === "first-party") &&
      config.timeScope !== "fixed-window" &&
      config.timeScope !== "cohort-history" &&
      config.timeScope !== "all-time",
  });
}

function isTimeVariable(name: string): boolean {
  return name === "timeRange" || /(?:Start|End)$/.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// ponytail: support the BigQuery and Postgres preset predicates in Analytics; extend when a new range shape is added.
function addCustomDateRange(
  sql: string,
  name: string,
): { sql: string; supported: boolean } {
  if (sql.includes(`{{${name}Start}}`) && sql.includes(`{{${name}End}}`)) {
    return { sql, supported: true };
  }

  const variable = `\\{\\{${escapeRegExp(name)}\\}\\}`;
  let replacements = 0;
  let result = sql;
  for (const [dateExpr, startExpr, endExpr] of [
    [
      `DATE_SUB\\(CURRENT_DATE\\(\\),\\s*INTERVAL\\s+365\\s+DAY\\)`,
      `DATE('{{${name}Start}}')`,
      `DATE('{{${name}End}}')`,
    ],
    [
      `to_char\\(CURRENT_DATE\\s*-\\s*INTERVAL\\s+'365 days',\\s*'YYYY-MM-DD'\\)`,
      `to_char('{{${name}Start}}'::date, 'YYYY-MM-DD')`,
      `to_char('{{${name}End}}'::date, 'YYYY-MM-DD')`,
    ],
  ]) {
    const branch = new RegExp(
      `\\(\\s*'${variable}'\\s*=\\s*'365d'\\s+AND\\s+((?:[\\w.]+|substr\\([\\w.]+,\\s*\\d+,\\s*\\d+\\)))\\s*>=\\s*${dateExpr}\\s*\\)(?=\\s*\\))`,
      "gi",
    );
    result = result.replace(branch, (match, column: string) => {
      replacements += 1;
      return `${match} OR ('{{${name}}}' = 'custom' AND ${column} >= ${startExpr} AND ${column} <= ${endExpr})`;
    });
  }

  if (replacements === 0) {
    return { sql: result, supported: !sql.includes(`{{${name}}}`) };
  }

  if (
    result.includes("AS start_date") &&
    result.includes("FROM signups") &&
    /UNNEST\(GENERATE_DATE_ARRAY\(start_date,\s*CURRENT_DATE\(\)\)\)/.test(
      result,
    )
  ) {
    const bounds = new RegExp(
      `(bounds\\s+AS\\s*\\(\\s*SELECT\\s+COALESCE\\(\\s*MIN\\(event_date\\),\\s*CASE\\s*)WHEN\\s*'${variable}'\\s*=\\s*'7d'`,
      "i",
    );
    result = result.replace(
      bounds,
      `$1WHEN '{{${name}}}' = 'custom' THEN DATE('{{${name}Start}}')\n      WHEN '{{${name}}}' = '7d'`,
    );
    result = result.replace(
      /UNNEST\(GENERATE_DATE_ARRAY\(start_date,\s*CURRENT_DATE\(\)\)\)/,
      `UNNEST(GENERATE_DATE_ARRAY(start_date, IF('{{${name}}}' = 'custom', LEAST(DATE('{{${name}End}}'), CURRENT_DATE()), CURRENT_DATE())))`,
    );
  }

  return { sql: result, supported: true };
}

export function interpolate(
  sql: string | undefined | null,
  vars: Record<string, string> = {},
  options: InterpolateOptions = {},
): string {
  if (typeof sql !== "string") return "";

  let sourceSql = sql;
  if (options.customDateRangeSupport) {
    for (const [name, value] of Object.entries(vars)) {
      if (value !== "custom") continue;
      const hasStart = Object.prototype.hasOwnProperty.call(
        vars,
        name + "Start",
      );
      const hasEnd = Object.prototype.hasOwnProperty.call(vars, name + "End");
      if (!hasStart && !hasEnd && name !== "timeRange") continue;
      if (!hasStart || !hasEnd) return "SELECT __invalid_custom_date_range__";
      const start = vars[name + "Start"];
      const end = vars[name + "End"];
      if (!isValidDate(start) || !isValidDate(end) || start > end) {
        return "SELECT __invalid_custom_date_range__";
      }
      if (
        /generate_series|generate_date_array/i.test(sourceSql) &&
        (Date.parse(`${end}T00:00:00.000Z`) -
          Date.parse(`${start}T00:00:00.000Z`)) /
          DAY_MILLISECONDS +
          1 >
          MAX_CUSTOM_DATE_RANGE_DAYS
      ) {
        return "SELECT __invalid_custom_date_range__";
      }
      const customRange = addCustomDateRange(sourceSql, name);
      if (!customRange.supported)
        return "SELECT __unsupported_custom_date_range__";
      sourceSql = customRange.sql;
    }
  }

  const conditionalRe = /\{\{\?(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const withConditionals = sourceSql.replace(
    conditionalRe,
    (_match, name, body) => {
      const value = vars[name];
      return value && value.length > 0 ? body : "";
    },
  );

  return withConditionals.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    const value = vars[name];
    if (
      options.failClosedTimeVariables &&
      isTimeVariable(name) &&
      (value == null || value.length === 0)
    ) {
      return "__missing_dashboard_time_filter__";
    }
    if (value == null) return "";
    return escapeSqlValue(String(value));
  });
}
