import { format, type SqlLanguage } from "sql-formatter";

import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

// Match {{name}} interpolation, {{?name}} conditional opens, and {{/name}}
// conditional closes. Without the conditional patterns sql-formatter rejects
// any panel that wraps optional filters in {{?...}}...{{/...}} blocks.
const TEMPLATE_PARAM_REGEX = String.raw`\{\{[?/]?[A-Za-z_][A-Za-z0-9_]*\}\}`;

function languageForSource(source: DataSourceType): SqlLanguage | null {
  if (source === "bigquery") return "bigquery";
  if (source === "first-party") return "postgresql";
  return null;
}

export function canFormatPanelSql(source: DataSourceType): boolean {
  return languageForSource(source) !== null;
}

export function formatPanelSql(sql: string, source: DataSourceType): string {
  const language = languageForSource(source);
  if (!language) return sql;

  return format(sql, {
    language,
    keywordCase: "upper",
    tabWidth: 2,
    linesBetweenQueries: 2,
    paramTypes: {
      custom: [{ regex: TEMPLATE_PARAM_REGEX }],
    },
  }).trim();
}

export function safeFormatPanelSql(
  sql: string,
  source: DataSourceType,
): { sql: string; error: string | null } {
  try {
    return { sql: formatPanelSql(sql, source), error: null };
  } catch (err) {
    return {
      sql,
      error: err instanceof Error ? err.message : "Failed to format SQL",
    };
  }
}
