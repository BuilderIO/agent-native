import {
  AgentSqlSyntaxError,
  lexAgentSql,
  type AgentSqlDialect,
  type AgentSqlToken,
} from "./lexer.js";

export interface AgentSqlQueryCte {
  name: string;
  quoted: boolean;
  start: number;
  end: number;
}

export interface AgentSqlQuerySource extends AgentSqlQueryCte {
  qualifiers: string[];
  cte: boolean;
  commaSeparated: boolean;
  modifiers: ("only" | "lateral")[];
  alias?: { name: string; quoted: boolean };
}

export interface AgentSqlQuery {
  sql: string;
  dialect: AgentSqlDialect;
  tokens: AgentSqlToken[];
  sources: AgentSqlQuerySource[];
  ctes: AgentSqlQueryCte[];
}

const CLAUSES = new Set([
  "where",
  "group",
  "having",
  "window",
  "qualify",
  "order",
  "limit",
  "offset",
  "fetch",
  "for",
]);
const JOIN_WORDS = new Set([
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
]);
const RESERVED_SOURCE_WORDS = new Set([
  ...CLAUSES,
  ...JOIN_WORDS,
  "select",
  "with",
  "from",
  "as",
  "on",
  "using",
  "outer",
  "union",
  "intersect",
  "except",
  "only",
  "lateral",
  "rows",
  "table",
  "values",
  "tablesample",
  "pivot",
  "unpivot",
  "match_recognize",
]);

function isName(token: AgentSqlToken | undefined): token is AgentSqlToken {
  return token?.kind === "word" || token?.kind === "quoted-identifier";
}

function word(token: AgentSqlToken | undefined): string | undefined {
  return token?.kind === "word" ? token.value : undefined;
}

function punctuation(token: AgentSqlToken | undefined, text: string): boolean {
  return token?.kind === "punctuation" && token.text === text;
}

interface CteDefinition {
  cte: AgentSqlQueryCte;
  bodyStart: number;
  bodyEnd: number;
}

class QueryReader {
  readonly sources: AgentSqlQuerySource[] = [];
  readonly ctes: AgentSqlQueryCte[] = [];
  readonly pairs = new Map<number, number>();

  constructor(
    readonly sql: string,
    readonly tokens: AgentSqlToken[],
    readonly dialect: AgentSqlDialect,
  ) {
    if (tokens.length > 50_000) this.fail("The SQL has too many tokens.", 0);
    const stack: number[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (punctuation(token, "(") || punctuation(token, "[")) {
        stack.push(index);
        if (stack.length > 128)
          this.fail("The SQL is nested too deeply.", index);
      } else if (punctuation(token, ")") || punctuation(token, "]")) {
        const open = stack.pop();
        if (
          open === undefined ||
          (token.text === ")"
            ? tokens[open].text !== "("
            : tokens[open].text !== "[")
        ) {
          this.fail("The SQL has mismatched delimiters.", index);
        }
        this.pairs.set(open, index);
      }
    }
    if (stack.length > 0)
      this.fail("The SQL has an unclosed delimiter.", stack[0]);
  }

  fail(message: string, index: number): never {
    throw new AgentSqlSyntaxError(
      "unsupported_syntax",
      message,
      this.tokens[index]?.start ?? this.sql.length,
    );
  }

  close(index: number): number {
    const close = this.pairs.get(index);
    if (close === undefined)
      this.fail("Expected a delimited SQL expression.", index);
    return close;
  }

  name(token: AgentSqlToken): string {
    // BigQuery dataset/table names preserve case even when unquoted.
    const name =
      this.dialect === "postgres"
        ? token.value
        : token.kind === "word"
          ? token.text
          : token.value;
    if (
      this.dialect === "postgres" &&
      new TextEncoder().encode(name).length > 63
    ) {
      this.fail(
        "Postgres identifiers longer than 63 bytes are not supported.",
        this.tokens.indexOf(token),
      );
    }
    return name;
  }

  binding(name: string): string {
    return this.dialect === "bigquery"
      ? name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
      : name;
  }

  identifier(index: number): AgentSqlToken {
    const token = this.tokens[index];
    if (
      !isName(token) ||
      (token.kind === "word" && RESERVED_SOURCE_WORDS.has(token.value))
    ) {
      this.fail("Expected an unambiguous SQL source identifier.", index);
    }
    return token;
  }

  queryStart(start: number, end: number): boolean {
    while (
      punctuation(this.tokens[start], "(") &&
      this.close(start) === end - 1
    ) {
      start++;
      end--;
    }
    const keyword = word(this.tokens[start]);
    // TABLE reads a relation without FROM and must not become an ordinary expression.
    if (
      this.dialect === "postgres" &&
      (keyword === "table" || keyword === "values")
    ) {
      this.fail("Only SELECT query expressions are supported.", start);
    }
    return keyword === "select" || keyword === "with";
  }

  columns(start: number): number {
    const end = this.close(start);
    let cursor = start + 1;
    if (cursor === end) this.fail("Expected at least one column name.", cursor);
    while (cursor < end) {
      this.identifier(cursor++);
      if (cursor === end) break;
      if (!punctuation(this.tokens[cursor++], ",") || cursor === end) {
        this.fail("Expected a comma-separated column name list.", cursor - 1);
      }
    }
    return end + 1;
  }

  withClause(
    start: number,
    end: number,
    inherited: Set<string>,
  ): { start: number; scope: Set<string> } {
    let cursor = start + 1;
    const recursive = word(this.tokens[cursor]) === "recursive";
    if (recursive) cursor++;
    const definitions: CteDefinition[] = [];
    const names = new Set<string>();
    while (cursor < end) {
      const token = this.identifier(cursor++);
      const cte = {
        name: this.name(token),
        quoted: token.kind === "quoted-identifier",
        start: token.start,
        end: token.end,
      };
      const key = this.binding(cte.name);
      if (names.has(key))
        this.fail("Duplicate CTE names are not supported.", cursor - 1);
      names.add(key);
      if (punctuation(this.tokens[cursor], "(")) cursor = this.columns(cursor);
      if (word(this.tokens[cursor++]) !== "as")
        this.fail("Expected AS in the CTE declaration.", cursor - 1);
      if (this.dialect === "postgres") {
        if (word(this.tokens[cursor]) === "not") {
          cursor++;
          if (word(this.tokens[cursor++]) !== "materialized")
            this.fail("Expected MATERIALIZED after NOT.", cursor - 1);
        } else if (word(this.tokens[cursor]) === "materialized") cursor++;
      }
      if (!punctuation(this.tokens[cursor], "("))
        this.fail("Expected a parenthesized CTE query.", cursor);
      const close = this.close(cursor);
      if (close >= end)
        this.fail("The CTE query exceeds its enclosing query.", cursor);
      definitions.push({ cte, bodyStart: cursor + 1, bodyEnd: close });
      cursor = close + 1;
      if (!punctuation(this.tokens[cursor], ",")) break;
      cursor++;
    }
    const scope = new Set(inherited);
    if (recursive) for (const name of names) scope.add(name);
    for (const definition of definitions) {
      this.ctes.push(definition.cte);
      this.query(definition.bodyStart, definition.bodyEnd, scope);
      scope.add(this.binding(definition.cte.name));
    }
    return { start: cursor, scope };
  }

  query(start: number, end: number, inherited: Set<string>): void {
    while (
      punctuation(this.tokens[start], "(") &&
      this.close(start) === end - 1
    ) {
      start++;
      end--;
    }
    let scope = inherited;
    if (word(this.tokens[start]) === "with")
      ({ start, scope } = this.withClause(start, end, inherited));
    let branch = start;
    for (let cursor = start; cursor < end; cursor++) {
      if (
        punctuation(this.tokens[cursor], "(") ||
        punctuation(this.tokens[cursor], "[")
      ) {
        cursor = this.close(cursor);
        continue;
      }
      const keyword = word(this.tokens[cursor]);
      if (
        keyword !== "union" &&
        keyword !== "intersect" &&
        keyword !== "except"
      )
        continue;
      // BigQuery's SELECT * EXCEPT(columns) is not a set operation.
      if (
        this.dialect === "bigquery" &&
        keyword === "except" &&
        punctuation(this.tokens[cursor + 1], "(") &&
        !this.queryStart(cursor + 2, this.close(cursor + 1))
      )
        continue;
      this.select(branch, cursor, scope);
      cursor++;
      if (
        word(this.tokens[cursor]) === "all" ||
        word(this.tokens[cursor]) === "distinct"
      )
        cursor++;
      branch = cursor;
      cursor--;
    }
    this.select(branch, end, scope);
  }

  expression(start: number, end: number, scope: Set<string>): void {
    for (let cursor = start; cursor < end; cursor++) {
      if (
        !punctuation(this.tokens[cursor], "(") &&
        !punctuation(this.tokens[cursor], "[")
      )
        continue;
      const close = this.close(cursor);
      if (
        punctuation(this.tokens[cursor], "(") &&
        this.queryStart(cursor + 1, close)
      ) {
        this.query(cursor + 1, close, scope);
      } else {
        this.expression(cursor + 1, close, scope);
      }
      cursor = close;
    }
  }

  select(start: number, end: number, scope: Set<string>): void {
    if (punctuation(this.tokens[start], "(")) {
      const close = this.close(start);
      if (!this.queryStart(start + 1, close))
        this.fail("Only SELECT query expressions are supported.", start);
      this.query(start + 1, close, scope);
      if (close + 1 < end) {
        if (!CLAUSES.has(word(this.tokens[close + 1]) ?? ""))
          this.fail("Unsupported text after a query expression.", close + 1);
        this.expression(close + 1, end, scope);
      }
      return;
    }
    if (word(this.tokens[start]) !== "select")
      this.fail("Only SELECT query expressions are supported.", start);
    let sawFrom = false;
    let afterFrom = false;
    for (let cursor = start + 1; cursor < end; cursor++) {
      if (
        punctuation(this.tokens[cursor], "(") ||
        punctuation(this.tokens[cursor], "[")
      ) {
        const close = this.close(cursor);
        this.expression(cursor, close + 1, scope);
        cursor = close;
        continue;
      }
      const keyword = word(this.tokens[cursor]);
      if (keyword === "from") {
        if (sawFrom || afterFrom)
          this.fail("Unexpected FROM at this query depth.", cursor);
        sawFrom = true;
        cursor = this.from(cursor + 1, end, scope) - 1;
      } else if (keyword && CLAUSES.has(keyword)) {
        afterFrom = true;
      } else if (
        keyword === "select" ||
        keyword === "with" ||
        keyword === "join"
      ) {
        this.fail("Unexpected query structure at this query depth.", cursor);
      }
    }
  }

  alias(
    cursor: number,
    end: number,
  ): { cursor: number; alias?: AgentSqlQuerySource["alias"] } {
    let explicit = false;
    if (word(this.tokens[cursor]) === "as") {
      explicit = true;
      cursor++;
    }
    const token = this.tokens[cursor];
    if (
      cursor < end &&
      isName(token) &&
      (token.kind === "quoted-identifier" ||
        !RESERVED_SOURCE_WORDS.has(token.value))
    ) {
      const alias = {
        name: this.name(token),
        quoted: token.kind === "quoted-identifier",
      };
      cursor++;
      if (punctuation(this.tokens[cursor], "(")) cursor = this.columns(cursor);
      return { cursor, alias };
    }
    if (explicit) this.fail("Expected a source alias after AS.", cursor);
    return { cursor };
  }

  source(
    start: number,
    end: number,
    scope: Set<string>,
    commaSeparated: boolean,
  ): number {
    let cursor = start;
    const modifiers: AgentSqlQuerySource["modifiers"] = [];
    if (word(this.tokens[cursor]) === "lateral") {
      modifiers.push("lateral");
      cursor++;
    }
    const only =
      this.dialect === "postgres" && word(this.tokens[cursor]) === "only";
    if (only) {
      modifiers.push("only");
      cursor++;
    }
    if (!only && punctuation(this.tokens[cursor], "(")) {
      const close = this.close(cursor);
      if (!this.queryStart(cursor + 1, close))
        this.fail("Grouped tables and joins are not supported.", cursor);
      this.query(cursor + 1, close, scope);
      return this.alias(close + 1, end).cursor;
    }
    const wrapped = only && punctuation(this.tokens[cursor], "(");
    const wrapper = cursor;
    if (wrapped) cursor++;
    const first = this.identifier(cursor++);
    let last = first;
    const parts =
      this.dialect === "bigquery"
        ? this.name(first).split(".")
        : [this.name(first)];
    while (punctuation(this.tokens[cursor], ".")) {
      last = this.identifier(cursor + 1);
      parts.push(
        ...(this.dialect === "bigquery"
          ? this.name(last).split(".")
          : [this.name(last)]),
      );
      cursor += 2;
    }
    if (parts.some((part) => part.length === 0))
      this.fail("Empty source path components are not supported.", start);
    if (
      this.dialect === "bigquery" &&
      parts.some((part) => /[*@$]/.test(part))
    ) {
      this.fail(
        "Wildcard and decorated BigQuery tables are not supported.",
        start,
      );
    }
    if (punctuation(this.tokens[cursor], "("))
      this.fail("Table functions are not supported.", cursor);
    if (wrapped) {
      if (cursor !== this.close(wrapper))
        this.fail("ONLY must contain exactly one relation name.", cursor);
      cursor++;
    }
    const result = this.alias(cursor, end);
    const name = parts[parts.length - 1];
    this.sources.push({
      name,
      qualifiers: parts.slice(0, -1),
      quoted: last.kind === "quoted-identifier",
      start: first.start,
      end: last.end,
      cte: parts.length === 1 && scope.has(this.binding(name)),
      commaSeparated,
      modifiers,
      ...(result.alias ? { alias: result.alias } : {}),
    });
    return result.cursor;
  }

  join(cursor: number): number {
    if (word(this.tokens[cursor]) === "natural") cursor++;
    const kind = word(this.tokens[cursor]);
    if (
      kind === "inner" ||
      kind === "left" ||
      kind === "right" ||
      kind === "full" ||
      kind === "cross"
    ) {
      cursor++;
      if (
        word(this.tokens[cursor]) === "outer" &&
        kind !== "inner" &&
        kind !== "cross"
      )
        cursor++;
    }
    if (word(this.tokens[cursor]) !== "join")
      this.fail("Unsupported JOIN structure.", cursor);
    return cursor + 1;
  }

  from(start: number, end: number, scope: Set<string>): number {
    let cursor = this.source(start, end, scope, false);
    while (cursor < end) {
      const keyword = word(this.tokens[cursor]);
      if (keyword && CLAUSES.has(keyword)) return cursor;
      if (punctuation(this.tokens[cursor], ",")) {
        cursor = this.source(cursor + 1, end, scope, true);
      } else if (keyword && JOIN_WORDS.has(keyword)) {
        cursor = this.source(this.join(cursor), end, scope, false);
      } else if (keyword === "using") {
        if (!punctuation(this.tokens[cursor + 1], "("))
          this.fail("Expected JOIN USING columns.", cursor + 1);
        cursor = this.columns(cursor + 1);
      } else if (keyword === "on") {
        const expressionStart = ++cursor;
        while (cursor < end) {
          if (
            punctuation(this.tokens[cursor], "(") ||
            punctuation(this.tokens[cursor], "[")
          ) {
            cursor = this.close(cursor) + 1;
            continue;
          }
          const next = word(this.tokens[cursor]);
          if (
            punctuation(this.tokens[cursor], ",") ||
            (next && (CLAUSES.has(next) || JOIN_WORDS.has(next)))
          )
            break;
          cursor++;
        }
        if (cursor === expressionStart)
          this.fail("Expected a JOIN condition.", cursor);
        this.expression(expressionStart, cursor, scope);
      } else {
        this.fail(
          "The SQL source boundary could not be established safely.",
          cursor,
        );
      }
    }
    return cursor;
  }
}

/** Reads sources in a bounded SELECT grammar; unsupported source syntax throws. */
export function readAgentSqlQuery(
  sql: string,
  options: { dialect: AgentSqlDialect },
): AgentSqlQuery {
  const tokens = lexAgentSql(sql, options);
  let end = tokens.length;
  if (punctuation(tokens[end - 1], ";")) end--;
  if (end === 0)
    throw new AgentSqlSyntaxError(
      "unsupported_syntax",
      "The SQL query is empty.",
      0,
    );
  const semicolon = tokens
    .slice(0, end)
    .find((token) => punctuation(token, ";"));
  if (semicolon)
    throw new AgentSqlSyntaxError(
      "unsupported_syntax",
      "Expected exactly one SQL query.",
      semicolon.start,
    );
  const reader = new QueryReader(sql, tokens, options.dialect);
  reader.query(0, end, new Set());
  return {
    sql,
    dialect: options.dialect,
    tokens,
    sources: reader.sources.sort((left, right) => left.start - right.start),
    ctes: reader.ctes.sort((left, right) => left.start - right.start),
  };
}

/** Replaces only analyzed source-name spans, preserving all other source text. */
export function rewriteAgentSqlQuerySources(
  query: AgentSqlQuery,
  replacer: (source: AgentSqlQuerySource) => string,
): string {
  const sources = [...query.sources].sort(
    (left, right) => left.start - right.start,
  );
  const tokenStarts = new Map(
    query.tokens.map((token, index) => [token.start, index]),
  );
  const tokenEnds = new Map(
    query.tokens.map((token, index) => [token.end, index]),
  );
  let cursor = 0;
  let sql = "";
  for (const source of sources) {
    if (
      !Number.isInteger(source.start) ||
      !Number.isInteger(source.end) ||
      source.start < cursor ||
      source.end <= source.start ||
      source.end > query.sql.length
    ) {
      throw new AgentSqlSyntaxError(
        "unsupported_syntax",
        "SQL source spans overlap or exceed the query.",
        source.start,
      );
    }
    const first = tokenStarts.get(source.start);
    const last = tokenEnds.get(source.end);
    if (
      first === undefined ||
      last === undefined ||
      last < first ||
      (last - first) % 2 !== 0
    ) {
      throw new AgentSqlSyntaxError(
        "unsupported_syntax",
        "SQL source spans must follow identifier token boundaries.",
        source.start,
      );
    }
    for (let index = first; index <= last; index++) {
      const token = query.tokens[index];
      if (
        ((index - first) % 2 === 0
          ? !isName(token)
          : !punctuation(token, ".")) ||
        query.sql.slice(token.start, token.end) !== token.text
      ) {
        throw new AgentSqlSyntaxError(
          "unsupported_syntax",
          "SQL source spans must contain exactly one identifier path.",
          source.start,
        );
      }
    }
    const replacement = replacer(source);
    if (typeof replacement !== "string" || replacement.trim().length === 0) {
      throw new AgentSqlSyntaxError(
        "unsupported_syntax",
        "A SQL source replacement must be nonempty text.",
        source.start,
      );
    }
    sql += query.sql.slice(cursor, source.start) + replacement;
    cursor = source.end;
  }
  return sql + query.sql.slice(cursor);
}
