export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 8000;
export const MAX_TAGS = 30;
export const MAX_EXTRA_KEYS = 30;
export const MAX_EXTRA_VALUE_LENGTH = 1000;

const SECRET_RE = /\b(?:bearer|basic)\s+[^\s]+/gi;
const SQL_PARAMS_RE = /^([\s\S]*?)(\r?\n[ \t]*params:\s*)[\s\S]*$/i;
const SQL_QUERY_FAILURE_RE = /\b(?:failed query|query failed):\s*/i;
const SQL_STATEMENT_RE =
  /^(?:select|insert|update|delete|merge|values|explain|call|execute|copy|declare)\b/i;
const SQL_CTE_NAME_RE = /^(?:"(?:[^"]|"")+"|[a-z_][\w$]*)/i;
const SQL_CTE_QUERY_RE =
  /^(?:select|insert|update|delete|merge|values|with|table)\b/i;
const SQL_CTE_IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[a-z_][\w$]*)`;
const SQL_CTE_IDENTIFIER_LIST = `${SQL_CTE_IDENTIFIER}(?:\\s*,\\s*${SQL_CTE_IDENTIFIER})*`;
const SQL_CTE_SEARCH_CLAUSE_RE = new RegExp(
  String.raw`^search\s+(?:breadth|depth)\s+first\s+by\s+${SQL_CTE_IDENTIFIER_LIST}\s+set\s+${SQL_CTE_IDENTIFIER}(?=$|[\s,])`,
  "i",
);
const SQL_CTE_CYCLE_CLAUSE_RE = new RegExp(
  String.raw`^cycle\s+${SQL_CTE_IDENTIFIER_LIST}\s+set\s+${SQL_CTE_IDENTIFIER}[\s\S]*?\s+using\s+${SQL_CTE_IDENTIFIER}(?=$|[\s,])`,
  "i",
);

export const SECRET_KEY_RE =
  /(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)/i;

function afterLeadingSqlComments(value: string): string {
  let statement = value.trimStart();
  while (statement.startsWith("--") || statement.startsWith("/*")) {
    if (statement.startsWith("--")) {
      const end = statement.indexOf("\n");
      if (end < 0) return "";
      statement = statement.slice(end + 1).trimStart();
      continue;
    }

    let depth = 1;
    let end = 2;
    while (depth > 0 && end < statement.length) {
      if (statement.startsWith("/*", end)) {
        depth++;
        end += 2;
      } else if (statement.startsWith("*/", end)) {
        depth--;
        end += 2;
      } else {
        end++;
      }
    }
    if (depth > 0) return "";
    statement = statement.slice(end).trimStart();
  }
  return statement;
}

function afterSqlParenthesizedBody(value: string): string | undefined {
  let depth = 0;
  let blockCommentDepth = 0;
  let quote: "'" | '"' | undefined;
  let escapeString = false;
  let dollarQuote: string | undefined;

  for (let index = 0; index < value.length; index++) {
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = undefined;
      }
      continue;
    }
    if (quote) {
      if (escapeString && value[index] === "\\") {
        index++;
      } else if (value[index] === quote) {
        if (value[index + 1] === quote) index++;
        else quote = undefined;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (value.startsWith("/*", index)) {
        blockCommentDepth++;
        index++;
      } else if (value.startsWith("*/", index)) {
        blockCommentDepth--;
        index++;
      }
      continue;
    }
    if (value.startsWith("--", index)) {
      const end = value.indexOf("\n", index + 2);
      if (end < 0) return undefined;
      index = end;
      continue;
    }
    if (value.startsWith("/*", index)) {
      blockCommentDepth = 1;
      index++;
      continue;
    }
    if (value[index] === "'" || value[index] === '"') {
      quote = value[index] as "'" | '"';
      escapeString =
        quote === "'" &&
        /(?:^|[^A-Za-z0-9_$])(?:E|U&)$/i.test(value.slice(0, index));
      continue;
    }
    if (value[index] === "$") {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
        value.slice(index),
      )?.[0];
      if (delimiter) {
        dollarQuote = delimiter;
        index += delimiter.length - 1;
        continue;
      }
    }
    if (value[index] === "(") depth++;
    else if (value[index] === ")" && --depth === 0)
      return value.slice(index + 1);
  }

  return undefined;
}

function isSqlCteStatement(value: string): boolean {
  let statement = afterLeadingSqlComments(value);
  const withPrefix = /^with\b/i.exec(statement);
  if (!withPrefix) return false;
  statement = afterLeadingSqlComments(statement.slice(withPrefix[0].length));

  const recursivePrefix = /^recursive\b/i.exec(statement);
  if (recursivePrefix) {
    statement = afterLeadingSqlComments(
      statement.slice(recursivePrefix[0].length),
    );
  }

  while (true) {
    const name = SQL_CTE_NAME_RE.exec(statement);
    if (!name) return false;

    let header = afterLeadingSqlComments(statement.slice(name[0].length));
    if (header.startsWith("(")) {
      const afterColumns = afterSqlParenthesizedBody(header);
      if (afterColumns === undefined) return false;
      header = afterLeadingSqlComments(afterColumns);
    }

    const asPrefix = /^as\b/i.exec(header);
    if (!asPrefix) return false;
    header = afterLeadingSqlComments(header.slice(asPrefix[0].length));

    const notPrefix = /^not\b/i.exec(header);
    if (notPrefix) {
      header = afterLeadingSqlComments(header.slice(notPrefix[0].length));
      const requiredMaterialized = /^materialized\b/i.exec(header);
      if (!requiredMaterialized) return false;
      header = afterLeadingSqlComments(
        header.slice(requiredMaterialized[0].length),
      );
    } else {
      const materializedPrefix = /^materialized\b/i.exec(header);
      if (materializedPrefix) {
        header = afterLeadingSqlComments(
          header.slice(materializedPrefix[0].length),
        );
      }
    }

    if (!header.startsWith("(")) return false;

    const afterBody = afterSqlParenthesizedBody(header);
    if (afterBody === undefined) return false;

    let remainder = afterLeadingSqlComments(afterBody);
    let searchClauseSeen = false;
    let cycleClauseSeen = false;
    while (true) {
      const searchClause = searchClauseSeen
        ? null
        : SQL_CTE_SEARCH_CLAUSE_RE.exec(remainder);
      const cycleClause =
        searchClause || cycleClauseSeen
          ? null
          : SQL_CTE_CYCLE_CLAUSE_RE.exec(remainder);
      const clause = searchClause ?? cycleClause;
      if (!clause) break;

      if (searchClause) searchClauseSeen = true;
      else cycleClauseSeen = true;
      remainder = afterLeadingSqlComments(remainder.slice(clause[0].length));
    }
    if (remainder.startsWith(",")) {
      statement = afterLeadingSqlComments(remainder.slice(1));
      continue;
    }
    return SQL_CTE_QUERY_RE.test(remainder);
  }
}

function startsWithSqlStatement(value: string): boolean {
  let statement = afterLeadingSqlComments(value);
  const errorPrefix = /^Error:\s*/i.exec(statement);
  if (errorPrefix) {
    statement = afterLeadingSqlComments(statement.slice(errorPrefix[0].length));
  }

  if (/^with\b/i.test(statement)) {
    return isSqlCteStatement(statement);
  }

  return SQL_STATEMENT_RE.test(statement);
}

export function isSqlQueryFailureText(value: string): boolean {
  const match = SQL_QUERY_FAILURE_RE.exec(value);
  return (
    match !== null &&
    startsWithSqlStatement(value.slice(match.index + match[0].length))
  );
}

export function isSqlStatementText(value: string): boolean {
  return startsWithSqlStatement(value) || isSqlQueryFailureText(value);
}

export function redact(value: string): string {
  return value
    .replace(SECRET_RE, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`)
    .replace(
      /([A-Za-z0-9_$.-]*(?:authorization|cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)[A-Za-z0-9_$.-]*\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1<redacted>",
    )
    .replace(SQL_PARAMS_RE, (match, query: string, params: string) =>
      isSqlStatementText(query) ? `${query}${params}<redacted>` : match,
    );
}

export function boundedText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const safe = redact(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

export function redactErrorStack(error: unknown): string | undefined {
  const stack =
    error instanceof Error
      ? error.stack
      : error && typeof error === "object" && "stack" in error
        ? error.stack
        : undefined;
  if (typeof stack !== "string") return undefined;

  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const prefix = `${error.name || "Error"}${error.message ? `: ${error.message}` : ""}`;
    const suffix = stack.slice(prefix.length);
    if (stack.startsWith(prefix) && (!suffix || /^\r?\n/.test(suffix))) {
      const safePrefix = error.message
        ? `${redact(error.name || "Error")}: ${redact(error.message)}`
        : redact(prefix);
      const safe = `${safePrefix}${redact(suffix)}`;
      return safe.length > MAX_STACK_LENGTH
        ? safe.slice(0, MAX_STACK_LENGTH)
        : safe;
    }
  }

  // ponytail: Unknown stack formats lose frames; keep whole-tail redaction until the source exposes a message boundary.
  return boundedText(stack, MAX_STACK_LENGTH);
}

export function safeValue(value: unknown, depth = 2): unknown {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string")
    return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
  if (depth <= 0) return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => safeValue(item, depth - 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
      const safeKey = boundedText(key, 100);
      out[safeKey] = SECRET_KEY_RE.test(safeKey)
        ? "<redacted>"
        : safeValue(child, depth - 1);
    }
    return out;
  }
  return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
}

export function safeTags(
  tags: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (Object.keys(out).length >= MAX_TAGS) break;
    if (value == null) continue;
    const safeKey = boundedText(key, 100);
    out[safeKey] = SECRET_KEY_RE.test(safeKey)
      ? "<redacted>"
      : boundedText(value, 200);
  }
  return out;
}

export interface ExceptionParts {
  type: string;
  message: string;
  stack?: string;
  diagnostics?: Record<string, unknown>;
}

const SAFE_ERROR_DIAGNOSTIC_KEYS = [
  "code",
  "errno",
  "severity",
  "constraint",
  "schema",
  "table",
  "column",
  "routine",
  "position",
] as const;

function exceptionDiagnostics(
  error: unknown,
  causeDepth: number,
): Record<string, unknown> | undefined {
  if (error == null || typeof error !== "object") return undefined;

  const source = error as Record<string, unknown>;
  const diagnostics: Record<string, unknown> = {};
  for (const key of SAFE_ERROR_DIAGNOSTIC_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      diagnostics[key] = boundedText(value, 200);
    } else if (typeof value === "number" || typeof value === "boolean") {
      diagnostics[key] = value;
    }
  }

  if (causeDepth > 0 && "cause" in source && source.cause != null) {
    const cause = source.cause;
    diagnostics.cause =
      typeof cause === "object"
        ? exceptionPartsWithDiagnostics(cause, causeDepth - 1)
        : boundedText(cause, MAX_MESSAGE_LENGTH);
  }

  return Object.keys(diagnostics).length ? diagnostics : undefined;
}

function exceptionPartsWithDiagnostics(
  error: unknown,
  causeDepth: number,
): ExceptionParts {
  if (error instanceof Error) {
    const stack = redactErrorStack(error);
    const diagnostics = exceptionDiagnostics(error, causeDepth);
    return {
      type: boundedText(error.name || "Error", 200),
      message: boundedText(
        error.message || error.name || "Error",
        MAX_MESSAGE_LENGTH,
      ),
      ...(stack ? { stack } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    };
  }
  const stack = redactErrorStack(error);
  const diagnostics = exceptionDiagnostics(error, causeDepth);
  return {
    type: "Error",
    message: boundedText(error, MAX_MESSAGE_LENGTH),
    ...(stack ? { stack } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function exceptionParts(error: unknown): ExceptionParts {
  // ponytail: Limit nested causes to two; raise this if production failures need deeper chains.
  return exceptionPartsWithDiagnostics(error, 2);
}
