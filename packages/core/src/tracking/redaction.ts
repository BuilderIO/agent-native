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
const SQL_CTE_QUERY_RE =
  /^(?:select|insert|update|delete|merge|values|with|table)\b/i;
const SQL_CTE_IDENTIFIER = String.raw`(?:[uU]&"(?:[^"]|"")*"|"(?:[^"]|"")+"|[_\p{ID_Start}][$\p{ID_Continue}]*)`;
const SQL_CTE_IDENTIFIER_RE = new RegExp(`^${SQL_CTE_IDENTIFIER}`, "iu");
const SQL_DOLLAR_QUOTE_RE =
  /^\$(?:[_\p{ID_Start}](?:(?!\$)\p{ID_Continue})*)?\$/u;

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

function sqlDollarQuoteDelimiter(
  value: string,
  index: number,
): string | undefined {
  if (value[index] !== "$" || isSqlIdentifierContinueBefore(value, index)) {
    return undefined;
  }
  return SQL_DOLLAR_QUOTE_RE.exec(value.slice(index))?.[0];
}

function isSqlIdentifierContinueBefore(value: string, index: number): boolean {
  if (index <= 0) return false;

  const lastCodeUnit = value.charCodeAt(index - 1);
  const previousIndex =
    index > 1 &&
    lastCodeUnit >= 0xdc00 &&
    lastCodeUnit <= 0xdfff &&
    value.charCodeAt(index - 2) >= 0xd800 &&
    value.charCodeAt(index - 2) <= 0xdbff
      ? index - 2
      : index - 1;
  return /(?:\$|\p{ID_Continue})$/u.test(value.slice(previousIndex, index));
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
        quote === "'" && /(?:^|[^A-Za-z0-9_$])E$/i.test(value.slice(0, index));
      continue;
    }
    const delimiter = sqlDollarQuoteDelimiter(value, index);
    if (delimiter) {
      dollarQuote = delimiter;
      index += delimiter.length - 1;
      continue;
    }
    if (value[index] === "(") depth++;
    else if (value[index] === ")" && --depth === 0)
      return value.slice(index + 1);
  }

  return undefined;
}

function afterSqlCteHeader(value: string): string | undefined {
  let statement = afterSqlIdentifier(value);
  if (statement === undefined) return undefined;
  if (statement.startsWith("(")) {
    const afterColumns = afterSqlParenthesizedBody(statement);
    if (afterColumns === undefined) return undefined;
    statement = afterLeadingSqlComments(afterColumns);
  }

  const as = /^as\b/i.exec(statement);
  if (!as) return undefined;
  statement = afterLeadingSqlComments(statement.slice(as[0].length));

  const not = /^not\b/i.exec(statement);
  if (not) {
    statement = afterLeadingSqlComments(statement.slice(not[0].length));
    const materialized = /^materialized\b/i.exec(statement);
    if (!materialized) return undefined;
    statement = afterLeadingSqlComments(
      statement.slice(materialized[0].length),
    );
  } else {
    const materialized = /^materialized\b/i.exec(statement);
    if (materialized) {
      statement = afterLeadingSqlComments(
        statement.slice(materialized[0].length),
      );
    }
  }

  return statement.startsWith("(") ? statement : undefined;
}

function afterSqlToken(value: string, token: RegExp): string | undefined {
  const statement = afterLeadingSqlComments(value);
  const match = token.exec(statement);
  return match ? statement.slice(match[0].length) : undefined;
}

function decodeSqlEscapeString(value: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < value.length; ) {
    if (value[index] !== "\\") {
      if (value.startsWith("''", index)) {
        decoded += "'";
        index += 2;
      } else {
        const character = String.fromCodePoint(value.codePointAt(index) ?? 0);
        decoded += character;
        index += character.length;
      }
      continue;
    }

    const escape =
      /^\\([0-7]{1,3}|x[\da-f]{1,2}|u[\da-f]{4}|U[\da-f]{8}|[\s\S])/iu.exec(
        value.slice(index),
      );
    if (!escape) return undefined;

    const sequence = escape[1];
    const codePoint = /^[0-7]/u.test(sequence)
      ? Number.parseInt(sequence, 8)
      : /^[xX]/u.test(sequence)
        ? Number.parseInt(sequence.slice(1), 16)
        : /^[uU]/u.test(sequence)
          ? Number.parseInt(sequence.slice(1), 16)
          : undefined;
    if (codePoint !== undefined) {
      if (
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return undefined;
      }
      decoded += String.fromCodePoint(codePoint);
    } else {
      const character = sequence.toLowerCase();
      decoded +=
        ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as const)[
          character as "b" | "f" | "n" | "r" | "t"
        ] ?? sequence;
    }
    index += escape[0].length;
  }
  return decoded;
}

function parseSqlStringConstantToken(
  value: string,
): { value: string; remainder: string } | undefined {
  const escapeString = /^[eE]'/.test(value);
  const literal = escapeString
    ? /^[eE]'((?:''|\\[\s\S]|[^'\\])*)'/u.exec(value)
    : /^'((?:''|[^'])*)'/u.exec(value);
  if (!literal) return undefined;

  const decoded = escapeString
    ? decodeSqlEscapeString(literal[1])
    : literal[1].replace(/''/g, "'");
  if (decoded === undefined) return undefined;
  return { value: decoded, remainder: value.slice(literal[0].length) };
}

function parseSqlStringConstant(
  value: string,
): { value: string; remainder: string } | undefined {
  const first = parseSqlStringConstantToken(value);
  if (!first) return undefined;

  let decoded = first.value;
  let remainder = first.remainder;
  while (true) {
    const next = afterLeadingSqlComments(remainder);
    const separator = remainder.slice(0, remainder.length - next.length);
    if (!/[\r\n]/u.test(separator)) break;

    const adjacent = parseSqlStringConstantToken(next);
    if (!adjacent) break;
    decoded += adjacent.value;
    remainder = adjacent.remainder;
  }

  return { value: decoded, remainder };
}

function afterSqlIdentifier(value: string): string | undefined {
  const statement = afterLeadingSqlComments(value);
  const identifier = SQL_CTE_IDENTIFIER_RE.exec(statement);
  if (!identifier) return undefined;

  let remainder = afterLeadingSqlComments(
    statement.slice(identifier[0].length),
  );
  if (!/^[uU]&\"/.test(identifier[0])) return remainder;

  const uescape = /^uescape(?![$\p{ID_Continue}])/iu.exec(remainder);
  if (!uescape) return remainder;

  remainder = afterLeadingSqlComments(remainder.slice(uescape[0].length));
  const escapeClause = parseSqlStringConstant(remainder);
  if (
    !escapeClause ||
    Array.from(escapeClause.value).length !== 1 ||
    /[\da-f+"'\s]/iu.test(escapeClause.value)
  ) {
    return undefined;
  }
  return afterLeadingSqlComments(escapeClause.remainder);
}

function afterSqlQualifiedIdentifier(value: string): string | undefined {
  let remainder = afterSqlIdentifier(value);
  if (remainder === undefined) return undefined;

  while (true) {
    const statement = afterLeadingSqlComments(remainder);
    if (!statement.startsWith(".")) return statement;
    remainder = afterSqlIdentifier(statement.slice(1));
    if (remainder === undefined) return undefined;
  }
}

function hasSqlCallStructure(value: string): boolean {
  const afterName = afterSqlQualifiedIdentifier(value);
  return (
    afterName !== undefined &&
    afterLeadingSqlComments(afterName).startsWith("(")
  );
}

function hasSqlExecuteStructure(value: string): boolean {
  const afterName = afterSqlIdentifier(value);
  return (
    afterName !== undefined &&
    (afterLeadingSqlComments(afterName).startsWith("(") ||
      afterSqlToken(afterName, /^using\b/i) !== undefined)
  );
}

function hasSqlUpdateStructure(value: string): boolean {
  let statement =
    afterSqlToken(value, /^only\b/i) ?? afterLeadingSqlComments(value);
  statement = afterSqlQualifiedIdentifier(statement) ?? "";
  if (!statement) return false;
  statement =
    afterSqlToken(statement, /^\*/u) ?? afterLeadingSqlComments(statement);
  if (afterSqlToken(statement, /^set\b/i) !== undefined) return true;

  const afterAs = afterSqlToken(statement, /^as\b/i);
  const afterAlias = afterSqlIdentifier(afterAs ?? statement);
  return (
    afterAlias !== undefined &&
    afterSqlToken(afterAlias, /^set\b/i) !== undefined
  );
}

function hasSqlDeclareCursorStructure(value: string): boolean {
  let statement = afterSqlIdentifier(value);
  if (statement === undefined) return false;

  while (true) {
    const option = afterSqlToken(
      statement,
      /^(?:binary|asensitive|insensitive|scroll)\b/i,
    );
    if (option !== undefined) {
      statement = option;
      continue;
    }

    const no = afterSqlToken(statement, /^no\b/i);
    if (no !== undefined) {
      const scroll = afterSqlToken(no, /^scroll\b/i);
      if (scroll === undefined) return false;
      statement = scroll;
      continue;
    }
    break;
  }

  statement = afterSqlToken(statement, /^cursor\b/i) ?? "";
  if (!statement) return false;

  const hold = afterSqlToken(statement, /^(?:with|without)\b/i);
  if (hold !== undefined) {
    statement = afterSqlToken(hold, /^hold\b/i) ?? "";
    if (!statement) return false;
  }

  const query = afterSqlToken(statement, /^for\b/i);
  return query !== undefined && startsWithSqlStatement(query);
}

function afterSqlKeywordOutsideQuotedText(
  value: string,
  keyword: string,
): string | undefined {
  const token = new RegExp(`^${keyword}(?![$\\p{ID_Continue}])`, "iu");
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
        quote === "'" && /(?:^|[^A-Za-z0-9_$])E$/i.test(value.slice(0, index));
      continue;
    }

    const delimiter = sqlDollarQuoteDelimiter(value, index);
    if (delimiter) {
      dollarQuote = delimiter;
      index += delimiter.length - 1;
      continue;
    }

    const match = token.exec(value.slice(index));
    if (match && !isSqlIdentifierContinueBefore(value, index)) {
      return afterLeadingSqlComments(value.slice(index + match[0].length));
    }
  }
  return undefined;
}

function afterSqlIdentifierList(value: string): string | undefined {
  let statement = afterSqlIdentifier(value);
  if (statement === undefined) return undefined;

  while (true) {
    const remainder = afterLeadingSqlComments(statement);
    if (!remainder.startsWith(",")) return remainder;
    statement = afterSqlIdentifier(remainder.slice(1));
    if (statement === undefined) return undefined;
  }
}

function afterSqlCteSearchClause(value: string): string | undefined {
  let statement = afterSqlToken(value, /^search\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlToken(statement, /^(?:breadth|depth)\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlToken(statement, /^first\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlToken(statement, /^by\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlIdentifierList(statement);
  if (statement === undefined) return undefined;
  statement = afterSqlToken(statement, /^set\b/i);
  if (statement === undefined) return undefined;
  return afterSqlIdentifier(statement);
}

function afterSqlCteCycleClause(value: string): string | undefined {
  let statement = afterSqlToken(value, /^cycle\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlIdentifierList(statement);
  if (statement === undefined) return undefined;
  statement = afterSqlToken(statement, /^set\b/i);
  if (statement === undefined) return undefined;
  statement = afterSqlIdentifier(statement);
  if (statement === undefined) return undefined;

  const afterUsing = afterSqlKeywordOutsideQuotedText(statement, "using");
  return afterUsing === undefined ? undefined : afterSqlIdentifier(afterUsing);
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
    const header = afterSqlCteHeader(statement);
    if (!header) return false;
    const afterBody = afterSqlParenthesizedBody(header);
    if (afterBody === undefined) return false;

    let remainder = afterLeadingSqlComments(afterBody);
    let searchClauseSeen = false;
    let cycleClauseSeen = false;
    while (true) {
      const searchClause = searchClauseSeen
        ? undefined
        : afterSqlCteSearchClause(remainder);
      const cycleClause =
        searchClause !== undefined || cycleClauseSeen
          ? undefined
          : afterSqlCteCycleClause(remainder);
      const clause = searchClause ?? cycleClause;
      if (clause === undefined) break;

      if (searchClause !== undefined) searchClauseSeen = true;
      else cycleClauseSeen = true;
      remainder = afterLeadingSqlComments(clause);
    }
    if (remainder.startsWith(",")) {
      statement = afterLeadingSqlComments(remainder.slice(1));
      continue;
    }
    return SQL_CTE_QUERY_RE.test(remainder);
  }
}

function hasSqlStatementStructure(statement: string): boolean {
  const match = SQL_STATEMENT_RE.exec(statement);
  if (!match) return false;

  const body = afterLeadingSqlComments(statement.slice(match[0].length));
  switch (match[0].toLowerCase()) {
    case "select":
      return (
        /\b(?:from|where|join|union|intersect|except|group\s+by|order\s+by|having|limit|offset|returning|into)\b/i.test(
          body,
        ) ||
        /\$[0-9]+|[?=*<>]/u.test(body) ||
        /^[0-9]|^\x27|^"/u.test(body.trimStart()) ||
        body.trimStart().startsWith("(")
      );
    case "insert":
      return (
        /^into\b/i.test(body) &&
        /\b(?:values|select|default\s+values)\b/i.test(body)
      );
    case "update":
      return hasSqlUpdateStructure(body);
    case "delete":
      return /^from\b/i.test(body);
    case "merge":
      return /^into\b/i.test(body) && /\busing\b/i.test(body);
    case "values":
      return /^\s*\(/u.test(body);
    case "call":
      return hasSqlCallStructure(body);
    case "execute":
      return hasSqlExecuteStructure(body);
    case "copy":
      return /\b(?:from|to)\b/i.test(body);
    case "declare":
      return hasSqlDeclareCursorStructure(body);
    case "explain": {
      let statement = afterLeadingSqlComments(body);
      if (statement.startsWith("(")) {
        const afterOptions = afterSqlParenthesizedBody(statement);
        if (afterOptions === undefined) return false;
        statement = afterLeadingSqlComments(afterOptions);
      } else {
        while (true) {
          const option =
            /^(?:analyze|verbose|costs|settings|buffers|wal|timing|summary|format)\b/i.exec(
              statement,
            );
          if (!option) break;
          statement = afterLeadingSqlComments(
            statement.slice(option[0].length),
          );
          if (option[0].toLowerCase() === "format") {
            const format = /^(?:text|xml|json|yaml)\b/i.exec(statement);
            if (!format) return false;
            statement = afterLeadingSqlComments(
              statement.slice(format[0].length),
            );
          } else {
            const boolean = /^(?:true|false|yes|no|on|off|1|0)\b/i.exec(
              statement,
            );
            if (boolean) {
              statement = afterLeadingSqlComments(
                statement.slice(boolean[0].length),
              );
            }
          }
        }
      }

      if (/^with\b/i.test(statement)) return isSqlCteStatement(statement);
      const nestedStatement = SQL_STATEMENT_RE.exec(statement);
      return (
        nestedStatement !== null &&
        nestedStatement[0].toLowerCase() !== "explain" &&
        hasSqlStatementStructure(statement)
      );
    }
    default:
      return false;
  }
}

function startsWithSqlStatement(
  value: string,
  requireStructure = true,
): boolean {
  let statement = afterLeadingSqlComments(value);
  const errorPrefix = /^Error:\s*/i.exec(statement);
  if (errorPrefix) {
    statement = afterLeadingSqlComments(statement.slice(errorPrefix[0].length));
  }

  if (/^with\b/i.test(statement)) {
    return isSqlCteStatement(statement);
  }

  return (
    SQL_STATEMENT_RE.test(statement) &&
    (!requireStructure || hasSqlStatementStructure(statement))
  );
}

export function isSqlQueryFailureText(value: string): boolean {
  const match = SQL_QUERY_FAILURE_RE.exec(value);
  return (
    match !== null &&
    startsWithSqlStatement(value.slice(match.index + match[0].length), false)
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
