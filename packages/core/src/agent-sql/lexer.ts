export type AgentSqlDialect = "postgres" | "bigquery";

export type AgentSqlTokenKind =
  /** Unquoted keyword or identifier. `value` is case-folded. */
  | "word"
  /** `"name"` on Postgres, `` `name` `` on BigQuery. `value` is the exact name. */
  | "quoted-identifier"
  | "string"
  | "number"
  /** `?`, `$1`, or BigQuery `@name` / `@@name`. */
  | "parameter"
  | "operator"
  | "punctuation";

export interface AgentSqlToken {
  kind: AgentSqlTokenKind;
  /** Source text of the token. */
  text: string;
  /** Identifier name as the database resolves it; source text otherwise. */
  value: string;
  start: number;
  end: number;
}

export type AgentSqlSyntaxErrorCode =
  | "unterminated"
  | "unsupported_syntax"
  | "unexpected_character";

/**
 * The lexer could not read the SQL the way the database would. Callers must
 * refuse to run the statement: a guard that skipped what it could not read
 * would be checking different text from what executes.
 */
export class AgentSqlSyntaxError extends Error {
  readonly code: AgentSqlSyntaxErrorCode;
  readonly position: number;

  constructor(
    code: AgentSqlSyntaxErrorCode,
    message: string,
    position: number,
  ) {
    super(message);
    this.name = "AgentSqlSyntaxError";
    this.code = code;
    this.position = position;
  }
}

// Postgres also allows a backtick in operator names; agent SQL rejects it
// because it reads as identifier quoting in other dialects.
const POSTGRES_OPERATOR_CHARS = new Set("+-*/<>=~!@#%^&|?");
const BIGQUERY_OPERATOR_CHARS = new Set("+-*/<>=~!%^&|");
const PUNCTUATION = new Set(["(", ")", "[", "]", ",", ";", ".", ":"]);

function isIdentStart(ch: string, dialect: AgentSqlDialect): boolean {
  if (/[A-Za-z_]/.test(ch)) return true;
  // Postgres accepts any non-ASCII letter in an unquoted identifier.
  return dialect === "postgres" && ch.charCodeAt(0) >= 0x80;
}

function isIdentPart(ch: string, dialect: AgentSqlDialect): boolean {
  if (/[A-Za-z0-9_]/.test(ch)) return true;
  if (dialect === "postgres") return ch === "$" || ch.charCodeAt(0) >= 0x80;
  return false;
}

// Exactly the whitespace Postgres skips. JavaScript's `\s` also matches
// Unicode spaces, which Postgres reads as identifier characters; treating them
// as separators would split one database identifier into several tokens.
const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

/** Postgres folds only the ASCII letters of unquoted identifiers. */
function foldAscii(text: string): string {
  return text.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

interface QuoteOptions {
  backslashEscapes: boolean;
  doubledQuoteEscapes: boolean;
}

class Scanner {
  readonly tokens: AgentSqlToken[] = [];
  pos = 0;

  constructor(
    readonly sql: string,
    readonly dialect: AgentSqlDialect,
  ) {}

  peek(offset = 0): string {
    return this.sql[this.pos + offset] ?? "";
  }

  push(kind: AgentSqlTokenKind, start: number, value?: string): void {
    const text = this.sql.slice(start, this.pos);
    this.tokens.push({
      kind,
      text,
      value: value ?? text,
      start,
      end: this.pos,
    });
  }

  fail(code: AgentSqlSyntaxErrorCode, message: string, at = this.pos): never {
    throw new AgentSqlSyntaxError(code, message, at);
  }

  /** A line comment ends at a line feed or a carriage return, as in Postgres. */
  skipLineComment(): void {
    while (
      this.pos < this.sql.length &&
      this.sql[this.pos] !== "\n" &&
      this.sql[this.pos] !== "\r"
    ) {
      this.pos++;
    }
  }

  skipBlockComment(): void {
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.sql.length) {
      if (this.peek() === "/" && this.peek(1) === "*") {
        // Postgres block comments nest; BigQuery's do not.
        depth = this.dialect === "postgres" ? depth + 1 : 1;
        this.pos += 2;
        continue;
      }
      if (this.peek() === "*" && this.peek(1) === "/") {
        depth--;
        this.pos += 2;
        if (depth === 0) return;
        continue;
      }
      this.pos++;
    }
    this.fail("unterminated", "Unterminated block comment.", start);
  }

  /** Consumes a quoted run starting at `this.pos` and returns its body. */
  readQuoted(quote: string, options: QuoteOptions, label: string): string {
    const start = this.pos;
    this.pos += quote.length;
    let body = "";
    while (this.pos < this.sql.length) {
      const ch = this.sql[this.pos];
      if (options.backslashEscapes && ch === "\\") {
        if (this.pos + 1 >= this.sql.length) break;
        body += this.sql.slice(this.pos, this.pos + 2);
        this.pos += 2;
        continue;
      }
      if (this.sql.startsWith(quote, this.pos)) {
        if (
          options.doubledQuoteEscapes &&
          this.sql.startsWith(quote, this.pos + quote.length)
        ) {
          body += quote;
          this.pos += quote.length * 2;
          continue;
        }
        this.pos += quote.length;
        return body;
      }
      body += ch;
      this.pos++;
    }
    this.fail("unterminated", `Unterminated ${label}.`, start);
  }

  readWord(start: number): void {
    while (
      this.pos < this.sql.length &&
      isIdentPart(this.peek(), this.dialect)
    ) {
      this.pos++;
    }
    this.push("word", start, foldAscii(this.sql.slice(start, this.pos)));
  }

  readNumber(start: number): void {
    const rest = this.sql.slice(this.pos);
    const match =
      /^0[xXoObB][0-9A-Fa-f_]+/.exec(rest) ??
      /^(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?/.exec(rest);
    if (!match) this.fail("unexpected_character", "Malformed number.");
    this.pos += match[0].length;
    // `1abc` is a lexing error on current Postgres and ambiguous elsewhere.
    if (isIdentStart(this.peek(), this.dialect)) {
      this.fail(
        "unsupported_syntax",
        "A number must not run directly into an identifier.",
      );
    }
    this.push("number", start);
  }

  readOperator(start: number, chars: Set<string>): void {
    while (this.pos < this.sql.length && chars.has(this.peek())) {
      // An operator never contains the start of a comment.
      const pair = this.peek() + this.peek(1);
      if (this.pos > start && (pair === "--" || pair === "/*")) break;
      this.pos++;
    }
    if (this.dialect === "postgres") {
      // Postgres drops a trailing + or - from a multi-character operator
      // unless the operator contains one of these characters, so `a=-1`
      // reads as `a = -1`.
      const text = this.sql.slice(start, this.pos);
      if (!/[~!@#%^&|`?]/.test(text)) {
        while (this.pos - start > 1 && /[+-]/.test(this.sql[this.pos - 1])) {
          this.pos--;
        }
      }
    }
    this.push("operator", start);
  }
}

function lexPostgres(s: Scanner): void {
  while (s.pos < s.sql.length) {
    const ch = s.peek();
    const next = s.peek(1);
    const start = s.pos;

    if (WHITESPACE.has(ch)) {
      s.pos++;
      continue;
    }
    if (ch === "-" && next === "-") {
      s.skipLineComment();
      continue;
    }
    if (ch === "/" && next === "*") {
      s.skipBlockComment();
      continue;
    }

    // U&'...' and U&"..." spell characters as escape codes, so their text
    // is not the name or value the database sees.
    if ((ch === "u" || ch === "U") && next === "&") {
      const quote = s.peek(2);
      if (quote === "'" || quote === '"') {
        s.fail(
          "unsupported_syntax",
          "Unicode-escaped strings and identifiers (U&) are not supported in agent SQL.",
        );
      }
    }

    if ((ch === "e" || ch === "E") && next === "'") {
      s.pos++;
      s.readQuoted(
        "'",
        { backslashEscapes: true, doubledQuoteEscapes: true },
        "escape string",
      );
      s.push("string", start);
      continue;
    }
    if (/[bBxXnN]/.test(ch) && next === "'") {
      s.pos++;
      s.readQuoted(
        "'",
        { backslashEscapes: false, doubledQuoteEscapes: true },
        "string",
      );
      s.push("string", start);
      continue;
    }
    if (ch === "'") {
      const previous = s.tokens.at(-1);
      if (previous?.kind === "string" && /^[eE]'/.test(previous.text)) {
        // PostgreSQL continuation inherits the E prefix across comments and
        // newlines; reading this as an ordinary string would hide SQL tokens.
        s.fail(
          "unsupported_syntax",
          "Continuation after an escape string is not supported in agent SQL.",
        );
      }
      s.readQuoted(
        "'",
        { backslashEscapes: false, doubledQuoteEscapes: true },
        "string",
      );
      s.push("string", start);
      continue;
    }
    if (ch === '"') {
      const name = s.readQuoted(
        '"',
        { backslashEscapes: false, doubledQuoteEscapes: true },
        "quoted identifier",
      );
      if (name.length === 0) {
        s.fail("unsupported_syntax", "Empty quoted identifier.", start);
      }
      s.push("quoted-identifier", start, name);
      continue;
    }

    if (ch === "$") {
      if (/\d/.test(next)) {
        s.pos++;
        while (/\d/.test(s.peek())) s.pos++;
        s.push("parameter", start);
        continue;
      }
      const tag = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(
        s.sql.slice(s.pos),
      );
      if (!tag) {
        s.fail("unexpected_character", 'Unexpected "$".');
      }
      const end = s.sql.indexOf(tag[0], s.pos + tag[0].length);
      if (end === -1) {
        s.fail("unterminated", "Unterminated dollar-quoted string.", start);
      }
      s.pos = end + tag[0].length;
      s.push("string", start);
      continue;
    }

    if (isIdentStart(ch, "postgres")) {
      s.readWord(start);
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(next))) {
      s.readNumber(start);
      continue;
    }
    if (ch === ":" && next === ":") {
      s.pos += 2;
      s.push("punctuation", start);
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      s.pos++;
      s.push("punctuation", start);
      continue;
    }
    if (ch === "?" && !POSTGRES_OPERATOR_CHARS.has(next)) {
      s.pos++;
      s.push("parameter", start);
      continue;
    }
    if (POSTGRES_OPERATOR_CHARS.has(ch)) {
      s.readOperator(start, POSTGRES_OPERATOR_CHARS);
      continue;
    }
    s.fail("unexpected_character", `Unexpected character "${ch}".`);
  }
}

function lexBigQuery(s: Scanner): void {
  while (s.pos < s.sql.length) {
    const ch = s.peek();
    const next = s.peek(1);
    const start = s.pos;

    if (WHITESPACE.has(ch)) {
      s.pos++;
      continue;
    }
    if (ch === "#" || (ch === "-" && next === "-")) {
      s.skipLineComment();
      continue;
    }
    if (ch === "/" && next === "*") {
      s.skipBlockComment();
      continue;
    }

    const literal = /^([rRbB]{0,2})('''|"""|'|")/.exec(s.sql.slice(s.pos));
    if (
      literal &&
      /^(?:|[rR]|[bB]|[rR][bB]|[bB][rR])$/.test(literal[1]) &&
      // A bare prefix letter is an identifier unless a quote follows it.
      (literal[1].length > 0 || ch === "'" || ch === '"')
    ) {
      const raw = /[rR]/.test(literal[1]);
      s.pos += literal[1].length;
      s.readQuoted(
        literal[2],
        { backslashEscapes: !raw, doubledQuoteEscapes: false },
        "string",
      );
      s.push("string", start);
      continue;
    }

    if (ch === "`") {
      const name = s.readQuoted(
        "`",
        { backslashEscapes: true, doubledQuoteEscapes: false },
        "quoted identifier",
      );
      if (name.length === 0 || name.includes("\\")) {
        s.fail(
          "unsupported_syntax",
          "Empty or escaped backtick identifiers are not supported in agent SQL.",
          start,
        );
      }
      s.push("quoted-identifier", start, name);
      continue;
    }

    if (ch === "@") {
      s.pos += next === "@" ? 2 : 1;
      if (!isIdentStart(s.peek(), "bigquery")) {
        s.fail("unexpected_character", 'Expected a parameter name after "@".');
      }
      while (isIdentPart(s.peek(), "bigquery")) s.pos++;
      s.push("parameter", start);
      continue;
    }
    if (ch === "?") {
      s.pos++;
      s.push("parameter", start);
      continue;
    }

    if (isIdentStart(ch, "bigquery")) {
      s.readWord(start);
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(next))) {
      s.readNumber(start);
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      s.pos++;
      s.push("punctuation", start);
      continue;
    }
    if (BIGQUERY_OPERATOR_CHARS.has(ch)) {
      s.readOperator(start, BIGQUERY_OPERATOR_CHARS);
      continue;
    }
    s.fail("unexpected_character", `Unexpected character "${ch}".`);
  }
}

/**
 * Splits agent-authored SQL into the tokens the target database will see.
 * Comments and whitespace are dropped; everything else is kept with its
 * source offsets. Throws {@link AgentSqlSyntaxError} for anything the lexer
 * cannot read the same way the database does.
 */
export function lexAgentSql(
  sql: string,
  options: { dialect: AgentSqlDialect },
): AgentSqlToken[] {
  const scanner = new Scanner(sql, options.dialect);
  if (options.dialect === "postgres") lexPostgres(scanner);
  else lexBigQuery(scanner);
  return scanner.tokens;
}
