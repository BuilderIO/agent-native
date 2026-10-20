import { describe, expect, it } from "vitest";

import {
  agentSqlCalledNames,
  agentSqlQualifiedReferences,
  AgentSqlSyntaxError,
  leadingAgentSqlKeyword,
  lexAgentSql,
  splitAgentSqlStatements,
} from "./index.js";

const pg = (sql: string) => lexAgentSql(sql, { dialect: "postgres" });
const bq = (sql: string) => lexAgentSql(sql, { dialect: "bigquery" });

function qualifiedPairs(sql: string, lex = pg) {
  return agentSqlQualifiedReferences(lex(sql)).map((ref) =>
    [...ref.qualifiers, ref.name].join("."),
  );
}

describe("lexAgentSql (postgres)", () => {
  it("folds unquoted identifiers and keeps quoted ones exact", () => {
    const tokens = pg('SELECT Title, "Body" FROM Notes');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ["word", "select"],
      ["word", "title"],
      ["punctuation", ","],
      ["quoted-identifier", "Body"],
      ["word", "from"],
      ["word", "notes"],
    ]);
  });

  it("drops line, block, and nested block comments", () => {
    const tokens = pg("SELECT /* a /* nested */ b */ 1 -- trailing\n FROM t");
    expect(tokens.map((t) => t.value)).toEqual(["select", "1", "from", "t"]);
  });

  it("ends a line comment at a carriage return, as Postgres does", () => {
    expect(pg("SELECT 1 -- note\rFROM t").map((t) => t.value)).toEqual([
      "select",
      "1",
      "from",
      "t",
    ]);
  });

  it("reads non-ASCII spaces as identifier characters, as Postgres does", () => {
    expect(pg("SELECT a b FROM t").map((t) => t.value)).toEqual([
      "select",
      "a b",
      "from",
      "t",
    ]);
    // So a dollar sign after one stays part of the identifier instead of
    // opening a dollar-quoted string.
    expect(pg("SELECT a $q$ FROM t").map((t) => t.value)).toEqual([
      "select",
      "a $q$",
      "from",
      "t",
    ]);
  });

  it("reads every string form as one token", () => {
    const tokens = pg(
      "SELECT 'it''s', E'a\\'b', $$x ' \" y$$, $tag$ $$ $tag$, B'101', X'ff'",
    );
    expect(tokens.filter((t) => t.kind === "string")).toHaveLength(6);
    expect(tokens.filter((t) => t.kind === "word")).toHaveLength(1);
  });

  it.each(["\n", "\r", " /* continuation */\n", " -- continuation\n"])(
    "refuses escape-string continuation across %j",
    (separator) => {
      expect(() => pg(`SELECT E'first'${separator}'second'`)).toThrow(
        /Continuation after an escape string/,
      );
    },
  );

  it("allows separate escape and ordinary strings in expressions", () => {
    expect(
      pg("SELECT E'first', 'second'").filter((t) => t.kind === "string"),
    ).toHaveLength(2);
    expect(
      pg("SELECT 'first'\n'second'").filter((t) => t.kind === "string"),
    ).toHaveLength(2);
  });

  it("keeps a dotted reference visible through comments and quoting", () => {
    expect(qualifiedPairs('SELECT * FROM "Sch" /* c */ . -- c\n "T"')).toEqual([
      "Sch.T",
    ]);
    expect(qualifiedPairs("SELECT n.id FROM notes n")).toEqual(["n.id"]);
    expect(qualifiedPairs("SELECT a.b.c FROM x")).toEqual(["a.b.c"]);
  });

  it("does not read identifiers inside strings or comments", () => {
    expect(qualifiedPairs("SELECT 'a.b' FROM t /* c.d */")).toEqual([]);
    expect(qualifiedPairs("SELECT $q$ a.b $q$ FROM t")).toEqual([]);
  });

  it("ends operators before a trailing sign, as Postgres does", () => {
    const operators = (sql: string) =>
      pg(sql)
        .filter((token) => token.kind === "operator")
        .map((token) => token.text);
    expect(operators("a=-1")).toEqual(["=", "-"]);
    expect(operators("a ====- b")).toEqual(["====", "-"]);
    expect(operators("a <=+- b")).toEqual(["<=", "+", "-"]);
    // Kept whole when the operator contains one of ~ ! @ # % ^ & | ` ?
    expect(operators("a @- b")).toEqual(["@-"]);
    expect(operators("a !=- b")).toEqual(["!=-"]);
  });

  it("tells parameters from dollar quotes", () => {
    const tokens = pg("SELECT $1, ? FROM t WHERE a = $2");
    expect(
      tokens.filter((t) => t.kind === "parameter").map((t) => t.text),
    ).toEqual(["$1", "?", "$2"]);
  });

  it("finds called names and the leading keyword", () => {
    const tokens = pg("(SELECT count(*), lower(name) FROM t)");
    expect(leadingAgentSqlKeyword(tokens)).toBe("select");
    expect(agentSqlCalledNames(tokens)).toEqual(["count", "lower"]);
  });

  it("splits statements and ignores a trailing semicolon", () => {
    expect(splitAgentSqlStatements(pg("SELECT 1;"))).toHaveLength(1);
    expect(splitAgentSqlStatements(pg("SELECT 1; SELECT 2"))).toHaveLength(2);
    expect(splitAgentSqlStatements(pg("SELECT ';' FROM t"))).toHaveLength(1);
  });

  describe("fails closed", () => {
    const unreadable: Array<[string, string]> = [
      ["unterminated string", "SELECT 'abc"],
      ["unterminated quoted identifier", 'SELECT "abc'],
      ["unterminated block comment", "SELECT 1 /* x"],
      ["unterminated nested comment", "SELECT 1 /* a /* b */"],
      ["unterminated dollar quote", "SELECT $x$ abc"],
      ["Unicode-escaped identifier", 'SELECT * FROM U&"t"'],
      ["Unicode-escaped string", "SELECT U&'t'"],
      ["backtick", "SELECT * FROM `t`"],
      ["empty quoted identifier", 'SELECT "" FROM t'],
      ["number running into a name", "SELECT 1abc"],
    ];
    for (const [label, sql] of unreadable) {
      it(`rejects ${label}`, () => {
        expect(() => pg(sql)).toThrow(AgentSqlSyntaxError);
      });
    }
  });
});

describe("lexAgentSql (bigquery)", () => {
  it("reads backtick paths as one identifier", () => {
    const tokens = bq("SELECT * FROM `proj.dataset.table` t");
    expect(tokens.find((t) => t.kind === "quoted-identifier")?.value).toBe(
      "proj.dataset.table",
    );
  });

  it("reads every string form, including double quotes, as strings", () => {
    const tokens = bq(
      `SELECT 'a\\'b', "c", r'\\d', b'x', '''multi ' line''', """d"""`,
    );
    expect(tokens.filter((t) => t.kind === "string")).toHaveLength(6);
  });

  it("drops hash comments and does not nest block comments", () => {
    expect(bq("SELECT 1 # note\n FROM t").map((t) => t.value)).toEqual([
      "select",
      "1",
      "from",
      "t",
    ]);
    expect(() => bq("SELECT /* a /* b */ 1")).not.toThrow();
  });

  it("reads named parameters", () => {
    expect(
      bq("SELECT * FROM t WHERE d > @start AND p = @@project_id")
        .filter((t) => t.kind === "parameter")
        .map((t) => t.text),
    ).toEqual(["@start", "@@project_id"]);
  });

  it("fails closed on unterminated or escaped identifiers", () => {
    expect(() => bq("SELECT * FROM `t")).toThrow(AgentSqlSyntaxError);
    expect(() => bq("SELECT * FROM `a\\`b`")).toThrow(AgentSqlSyntaxError);
    expect(() => bq("SELECT '''abc")).toThrow(AgentSqlSyntaxError);
  });
});
