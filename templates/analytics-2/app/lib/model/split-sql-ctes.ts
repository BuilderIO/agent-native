export interface SqlCtePart {
  name: string;
  sql: string;
}

export interface SplitSqlCtesResult {
  ctes: SqlCtePart[];
  finalSql: string;
}

function skipWhitespaceAndComments(sql: string, start: number): number {
  let index = start;
  while (index < sql.length) {
    const ch = sql[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index++;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const nl = sql.indexOf("\n", index + 2);
      index = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) return sql.length;
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function scanQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    const ch = sql[index];
    if (ch === "\\" && quote !== '"' && index + 1 < sql.length) {
      index += 2;
      continue;
    }
    if (ch === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index++;
  }
  return -1;
}

function scanBalancedParens(sql: string, openIndex: number): number {
  if (sql[openIndex] !== "(") return -1;
  let depth = 1;
  let index = openIndex + 1;
  while (index < sql.length) {
    const ch = sql[index];
    if (ch === "'" || ch === '"' || ch === "`") {
      const next = scanQuoted(sql, index, ch);
      if (next === -1) return -1;
      index = next;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const nl = sql.indexOf("\n", index + 2);
      index = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 2;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return index;
    }
    index++;
  }
  return -1;
}

function readIdentifier(
  sql: string,
  start: number,
): { name: string; end: number } | null {
  const ch = sql[start];
  if (!ch) return null;
  if (ch === '"' || ch === "`") {
    const end = scanQuoted(sql, start, ch);
    if (end === -1) return null;
    const raw = sql.slice(start + 1, end - 1).replaceAll(ch + ch, ch);
    return raw ? { name: raw, end } : null;
  }
  const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(start));
  if (!match) return null;
  return { name: match[0], end: start + match[0].length };
}

/**
 * Splits a SQL query with a leading `WITH` clause into its ordered CTEs and
 * trailing statement. Returns `null` when the query has no CTEs or cannot be
 * cleanly parsed.
 */
export function splitSqlCtes(sql: string): SplitSqlCtesResult | null {
  let cursor = skipWhitespaceAndComments(sql, 0);
  const withMatch = /^WITH\b/i.exec(sql.slice(cursor));
  if (!withMatch) return null;
  cursor = skipWhitespaceAndComments(sql, cursor + withMatch[0].length);
  const recursiveMatch = /^RECURSIVE\b/i.exec(sql.slice(cursor));
  if (recursiveMatch) {
    cursor = skipWhitespaceAndComments(sql, cursor + recursiveMatch[0].length);
  }

  const ctes: SqlCtePart[] = [];
  while (cursor < sql.length) {
    const ident = readIdentifier(sql, cursor);
    if (!ident) return null;
    cursor = skipWhitespaceAndComments(sql, ident.end);

    if (sql[cursor] === "(") {
      const closeCols = scanBalancedParens(sql, cursor);
      if (closeCols === -1) return null;
      cursor = skipWhitespaceAndComments(sql, closeCols + 1);
    }

    const asMatch = /^AS\b/i.exec(sql.slice(cursor));
    if (!asMatch) return null;
    cursor = skipWhitespaceAndComments(sql, cursor + asMatch[0].length);

    if (sql[cursor] !== "(") return null;
    const closeBody = scanBalancedParens(sql, cursor);
    if (closeBody === -1) return null;

    const body = sql.slice(cursor + 1, closeBody).trim();
    if (!body) return null;
    ctes.push({ name: ident.name, sql: body });

    cursor = skipWhitespaceAndComments(sql, closeBody + 1);
    if (sql[cursor] === ",") {
      cursor = skipWhitespaceAndComments(sql, cursor + 1);
      continue;
    }
    break;
  }

  if (ctes.length === 0) return null;
  const finalSql = sql.slice(cursor).trim();
  if (!finalSql) return null;
  return { ctes, finalSql };
}

/** Returns the first earlier CTE name referenced as a word in `sql`, or null. */
export function referencedCteName(
  sql: string,
  priorCteNames: readonly string[],
): string | null {
  for (const name of priorCteNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sql)) return name;
  }
  return null;
}
