const MUTATING_WORD_RE =
  /(^|[^A-Za-z_])(insert|update|delete|replace|create|alter|drop|truncate|merge)(?=[^A-Za-z_]|$)/i;

function hasBigQueryRawStringPrefix(sql: string, quoteIndex: number): boolean {
  const prefix = sql.slice(0, quoteIndex).match(/([bBrR]{1,2})$/)?.[1];
  if (!prefix || !["r", "br", "rb"].includes(prefix.toLowerCase())) {
    return false;
  }
  const beforePrefix = sql[quoteIndex - prefix.length - 1];
  return !beforePrefix || !/[A-Za-z0-9_]/.test(beforePrefix);
}

function sanitizeSqlForInspection(
  sql: string,
  dialect: "bigquery" | "standard",
): string {
  let out = "";
  let state: "code" | "single" | "double" | "backtick" | "line" | "block" =
    "code";
  let quoteLength = 1;
  let rawString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === "line") {
      out += ch === "\n" || ch === "\r" ? ch : " ";
      if (ch === "\n" || ch === "\r") state = "code";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 1;
        state = "code";
      } else {
        out += " ";
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "backtick") {
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (dialect === "bigquery" && ch === "\\" && !rawString) {
        // BigQuery escape forms are rejected so they cannot hide statement boundaries.
        throw new Error("Source SQL string escapes are not supported.");
      }
      if (quoteLength === 3) {
        if (ch === quote && sql[i + 1] === quote && sql[i + 2] === quote) {
          out += "   ";
          i += 2;
          state = "code";
          quoteLength = 1;
          rawString = false;
        } else {
          out += " ";
        }
        continue;
      }
      if (ch === quote && next === quote) {
        out += "  ";
        i += 1;
      } else if (ch === quote) {
        out += " ";
        state = "code";
        rawString = false;
      } else {
        out += " ";
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      out += "  ";
      i += 1;
      state = "line";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 1;
      state = "block";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const tripleQuoted =
        dialect === "bigquery" &&
        ch !== "`" &&
        next === ch &&
        sql[i + 2] === ch;
      rawString =
        dialect === "bigquery" &&
        ch !== "`" &&
        hasBigQueryRawStringPrefix(sql, i);
      state = ch === "'" ? "single" : ch === '"' ? "double" : "backtick";
      quoteLength = tripleQuoted ? 3 : 1;
      if (tripleQuoted) {
        out += "   ";
        i += 2;
        continue;
      }
    }
    out += ch;
  }
  if (
    state === "single" ||
    state === "double" ||
    state === "backtick" ||
    state === "block"
  ) {
    throw new Error(
      "Source SQL contains an unterminated quoted value or comment.",
    );
  }
  return out;
}

export function assertReadOnlySql(
  sql: string,
  dialect: "bigquery" | "standard" = "standard",
): void {
  const cleaned = sanitizeSqlForInspection(sql, dialect).trim();
  if (!/^(select|with)\b/i.test(cleaned)) {
    throw new Error("Source SQL must start with SELECT or WITH.");
  }
  const statement = cleaned.replace(/;\s*$/, "");
  if (statement.includes(";")) {
    throw new Error("Source SQL must be a single statement.");
  }
  if (/\binto\b/i.test(statement)) {
    throw new Error("Source SQL must not use SELECT INTO.");
  }
  if (
    /\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i.test(statement)
  ) {
    throw new Error("Source SQL must not lock rows.");
  }
  if (MUTATING_WORD_RE.test(statement)) {
    throw new Error("Source SQL must be read-only.");
  }
}
