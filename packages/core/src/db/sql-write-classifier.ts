/**
 * Whether a SQL string may write, from its text alone. It fails closed: only a
 * statement known to be a read is one, so an unknown verb, a script the
 * scanner cannot finish reading, and text that is not a string all may write.
 * This is not `isSqlRead` in `create-get-db.ts`, which treats every `WITH` as
 * a read because it only decides whether a failed query is safe to retry.
 */

// Transaction control and session settings change no stored data. `SELECT`
// covers `FOR UPDATE`, `pg_advisory_xact_lock`, `set_config` and `nextval`.
const READ_VERBS = new Set([
  "SELECT",
  "SHOW",
  "VALUES",
  "BEGIN",
  "START",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "SET",
  "RESET",
]);

/** A `WITH` is a read unless one of its common table expressions writes. */
const WRITING_WORD = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i;
/** `SELECT ... INTO` creates a table. */
const INTO_WORD = /\bINTO\b/i;
const ANALYZE_WORD = /\bANALY[SZ]E\b/i;
const FINISHES_PREPARED = /^(?:COMMIT|ROLLBACK)\s+PREPARED\b/i;
const IDENTIFIER_CHAR = /[\w$\u0080-￿]/;
const DOLLAR_QUOTE_TAG = /^\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/;

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_CHAR.test(char);
}

/**
 * `sql` with every comment, string literal, quoted identifier and
 * dollar-quoted body blanked, so a verb or a `;` in any of them reads as
 * nothing. `undefined` when one never ends, since then nothing says where the
 * statement does.
 */
function maskSql(sql: string): string | undefined {
  let masked = "";
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      masked += " ";
      i = end === -1 ? sql.length : end + 1;
    } else if (char === "/" && next === "*") {
      // PostgreSQL block comments nest.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) return undefined;
      masked += " ";
    } else if (char === "'" || char === '"') {
      // A backslash escapes only inside an `E'...'` string.
      const escapes =
        char === "'" &&
        (sql[i - 1] === "E" || sql[i - 1] === "e") &&
        !isIdentifierChar(sql[i - 2]);
      let closed = false;
      i += 1;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") {
          i += 2;
        } else if (sql[i] === char) {
          if (sql[i + 1] === char) {
            i += 2;
          } else {
            closed = true;
            i += 1;
            break;
          }
        } else {
          i += 1;
        }
      }
      if (!closed) return undefined;
      masked += char + char;
    } else if (char === "$" && !isIdentifierChar(sql[i - 1])) {
      const tag = DOLLAR_QUOTE_TAG.exec(sql.slice(i))?.[0];
      if (!tag) {
        masked += char;
        i += 1;
        continue;
      }
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return undefined;
      masked += "$$";
      i = end + tag.length;
    } else {
      masked += char;
      i += 1;
    }
  }
  return masked;
}

function isReadStatement(statement: string): boolean {
  const text = statement.replace(/^[\s(]+/, "");
  const verb = /^[A-Za-z_]+/.exec(text)?.[0].toUpperCase();
  if (!verb) return false;
  if (verb === "WITH") return !WRITING_WORD.test(text) && !INTO_WORD.test(text);
  if (verb === "EXPLAIN") return !ANALYZE_WORD.test(text);
  if (!READ_VERBS.has(verb)) return false;
  if (FINISHES_PREPARED.test(text)) return false;
  return verb !== "SELECT" || !INTO_WORD.test(text);
}

/** Whether running `sql` may write, or `sql` cannot be told to be a read. */
export function sqlMayWrite(sql: unknown): boolean {
  if (typeof sql !== "string") return true;
  const masked = maskSql(sql);
  if (masked === undefined) return true;
  const statements = masked
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
  return statements.length === 0 || !statements.every(isReadStatement);
}
