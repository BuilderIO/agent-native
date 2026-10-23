import { fail } from "@agent-native/core/action";

function rejectSourceSql(message: string): never {
  return fail(message, { errorCode: "invalid_source_sql", statusCode: 400 });
}

const MUTATING_WORD_RE =
  /(^|[^\p{ID_Continue}$])(insert|update|delete|replace|create|alter|drop|truncate|merge)(?=[^\p{ID_Continue}$]|$)/iu;

function hasBigQueryRawStringPrefix(sql: string, quoteIndex: number): boolean {
  const prefix = sql.slice(0, quoteIndex).match(/([bBrR]{1,2})$/)?.[1];
  if (!prefix || !["r", "br", "rb"].includes(prefix.toLowerCase())) {
    return false;
  }
  const beforePrefix = sql[quoteIndex - prefix.length - 1];
  return !beforePrefix || !/[A-Za-z0-9_]/.test(beforePrefix);
}

const TEMPLATE_SLOT_AT = /\{\{\w+(:list)?\}\}/y;

// Sticky so each lookup costs only the slot's own length; slicing the rest of
// a 50,000-character template at every `{{` or `\` makes validation quadratic.
function templateSlotAt(sql: string, index: number): RegExpExecArray | null {
  TEMPLATE_SLOT_AT.lastIndex = index;
  return TEMPLATE_SLOT_AT.exec(sql);
}

function sanitizeSqlForInspection(
  sql: string,
  dialect: "bigquery" | "standard",
  validateTemplateVariables = false,
): string {
  let out = "";
  let state: "code" | "single" | "double" | "backtick" | "line" | "block" =
    "code";
  let quoteLength = 1;
  let rawString = false;
  let quoteStart = 0;
  let checkedSlotRunEnd = -1;
  const inspectTemplateLiteral = (end: number) => {
    if (
      validateTemplateVariables &&
      /\{\{\w+(?::list)?\}\}/.test(sql.slice(quoteStart, end)) &&
      (rawString ||
        state === "backtick" ||
        (dialect === "standard" && state === "double") ||
        /\{\{\w+:list\}\}/.test(sql.slice(quoteStart, end)))
    ) {
      rejectSourceSql(
        "Scalar SQL template variables require ordinary quoted strings; list variables require standalone SQL positions, not raw literals or identifiers.",
      );
    }
  };
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (validateTemplateVariables && ch === "{" && next === "{") {
      const variable = templateSlotAt(sql, i);
      if (variable && (state === "line" || state === "block")) {
        rejectSourceSql("SQL template variables must not occur in comments.");
      }
      if (variable && state === "code") {
        const adjacent = `${sql[i - 1] ?? ""}${sql[i + variable[0].length] ?? ""}`;
        if (
          !variable[1] ||
          /[\p{ID_Continue}$'"`\\{}]/u.test(adjacent) ||
          // A list renders quoted items, so `U&` before it makes a U& string,
          // and PostgreSQL reads any non-ASCII neighbor as identifier text.
          (dialect === "standard" &&
            (sql[i - 1] === "&" || /[^\x00-\x7f]/.test(adjacent)))
        ) {
          rejectSourceSql(
            "Scalar SQL template variables require ordinary quoted strings; list variables require standalone SQL positions.",
          );
        }
        out += " ".repeat(variable[0].length);
        i += variable[0].length - 1;
        continue;
      }
      // An empty value joins the quotes around a slot run, which can form a
      // new delimiter (`'''x'{{v}}''` closes early), so only a triple-quoted
      // string's own delimiters may touch the run. Each run is checked once,
      // from its first slot.
      if (
        variable &&
        (state === "single" || state === "double") &&
        !rawString &&
        quoteLength === 3 &&
        i >= checkedSlotRunEnd
      ) {
        const quote = state === "single" ? "'" : '"';
        let runEnd = i + variable[0].length;
        let slot: RegExpExecArray | null;
        while ((slot = templateSlotAt(sql, runEnd))) {
          runEnd += slot[0].length;
        }
        checkedSlotRunEnd = runEnd;
        const opensString = i === quoteStart + quoteLength;
        const closesString = sql.startsWith(quote.repeat(3), runEnd);
        if (
          (sql[i - 1] === quote && !opensString) ||
          (sql[runEnd] === quote && !closesString)
        ) {
          rejectSourceSql(
            "SQL template variables must not touch a quote inside a string.",
          );
        }
      }
    }
    if (state === "line") {
      out += ch === "\n" || ch === "\r" ? ch : " ";
      if (ch === "\n" || ch === "\r") state = "code";
      continue;
    }
    if (state === "block") {
      // PostgreSQL nests block comments, so its comment would outlast this
      // scan's and hide which slots are quoted.
      if (
        validateTemplateVariables &&
        dialect === "standard" &&
        ch === "/" &&
        next === "*"
      ) {
        rejectSourceSql("First-party record templates must not nest comments.");
      }
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
        if (
          next === undefined ||
          (!rawString && (next === "\n" || next === "\r"))
        ) {
          rejectSourceSql("Source SQL contains an incomplete string escape.");
        }
        // A static backslash before a slot pairs with the interpolator's own
        // escape backslash and leaves the value's quote unescaped.
        if (
          validateTemplateVariables &&
          !rawString &&
          templateSlotAt(sql, i + 1)
        ) {
          rejectSourceSql(
            "SQL template variables must not follow a backslash escape.",
          );
        }
        // Raw literals preserve both characters, but still pair backslashes
        // with delimiters when finding the end of the literal.
        out += "  ";
        i += 1;
        continue;
      }
      if (quoteLength === 3) {
        if (ch === quote && sql[i + 1] === quote && sql[i + 2] === quote) {
          inspectTemplateLiteral(i);
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
        // GoogleSQL closes the literal here; reading `''` as an escape would
        // place later slots inside a string GoogleSQL treats as code.
        if (validateTemplateVariables && dialect === "bigquery") {
          rejectSourceSql(
            "BigQuery record templates must not use doubled quotes inside a string; use a backslash escape.",
          );
        }
        out += "  ";
        i += 1;
      } else if (ch === quote) {
        inspectTemplateLiteral(i);
        out += " ";
        state = "code";
        rawString = false;
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
    // First-party SQL is lexed as PostgreSQL, then re-quoted for GoogleSQL.
    // Prefixed and dollar-quoted strings, backticks and `#` read differently
    // across those steps and this scan, which could leave a slot in code.
    if (validateTemplateVariables && dialect === "standard") {
      if (ch === "$" || ch === "`" || ch === "#") {
        rejectSourceSql(
          "First-party record templates must not use $, ` or # outside strings.",
        );
      }
      if (ch === "'" && /[\p{ID_Continue}$&\u0080-￿]/u.test(sql[i - 1] ?? "")) {
        rejectSourceSql(
          "First-party record templates must use plain quoted strings: put a space between a prefix such as DATE and its quote, and don't use E, U&, B, X or N strings.",
        );
      }
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quoteStart = i;
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
    rejectSourceSql(
      "Source SQL contains an unterminated quoted value or comment.",
    );
  }
  return out;
}

export function assertRecordTemplateLiteralContexts(
  sql: string,
  dialect: "bigquery" | "standard",
): void {
  if (/\{\{\?\w+\}\}/.test(sql)) {
    rejectSourceSql(
      "Record templates must not use conditional blocks. Use SQL CASE expressions with ordinary template variables.",
    );
  }
  sanitizeSqlForInspection(sql, dialect, true);
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
