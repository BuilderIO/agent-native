import { fail } from "@agent-native/core/action";

function rejectSourceSql(message: string): never {
  return fail(message, { errorCode: "invalid_source_sql", statusCode: 400 });
}

// `replace` followed by `(` is the string function or BigQuery's
// `SELECT * REPLACE (...)`; `REPLACE INTO` is still rejected.
const MUTATING_WORD_RE =
  /(^|[^\p{ID_Continue}$])(insert|update|delete|replace(?!\s*\()|create|alter|drop|truncate|merge)(?=[^\p{ID_Continue}$]|$)/iu;

function sanitizeSqlForInspection(
  sql: string,
  dialect: "bigquery" | "standard",
): string {
  let out = "";
  let state: "code" | "single" | "double" | "backtick" | "line" | "block" =
    "code";
  let quoteLength = 1;
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
      if (dialect === "bigquery" && ch === "\\") {
        // BigQuery's lexer pairs a backslash with the next character in every
        // string, raw ones included (raw strings only skip the unescaping),
        // so an escaped quote never ends the string. A trailing backslash
        // leaves it unterminated.
        out += next === undefined ? " " : "  ";
        i += 1;
        continue;
      }
      if (quoteLength === 3) {
        if (ch === quote && sql[i + 1] === quote && sql[i + 2] === quote) {
          out += "   ";
          i += 2;
          state = "code";
          quoteLength = 1;
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
      } else {
        out += " ";
      }
      continue;
    }
    if (dialect === "bigquery" && ch === "#") {
      out += " ";
      state = "line";
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
    rejectSourceSql(
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
    rejectSourceSql("Source SQL must start with SELECT or WITH.");
  }
  const statement = cleaned.replace(/;\s*$/, "");
  if (statement.includes(";")) {
    rejectSourceSql("Source SQL must be a single statement.");
  }
  if (/\binto\b/i.test(statement)) {
    rejectSourceSql("Source SQL must not use SELECT INTO.");
  }
  if (
    /\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i.test(statement)
  ) {
    rejectSourceSql("Source SQL must not lock rows.");
  }
  if (MUTATING_WORD_RE.test(statement)) {
    rejectSourceSql("Source SQL must be read-only.");
  }
}
