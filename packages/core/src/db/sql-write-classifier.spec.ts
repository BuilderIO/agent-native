import { describe, expect, it } from "vitest";

import { sqlMayWrite } from "./sql-write-classifier.js";

const reads: Array<[string, string]> = [
  ["select", "SELECT * FROM designs WHERE id = $1"],
  ["lowercase select", "select id from designs"],
  ["select with a trailing semicolon", "SELECT 1;"],
  ["select with blank statements after it", "SELECT 1;  ;\n"],
  ["leading whitespace and newlines", "\n\t  SELECT 1"],
  ["a leading line comment", "-- load the design\nSELECT 1"],
  ["a leading block comment", "/* load */ SELECT 1"],
  [
    "a nested block comment",
    "/* outer /* inner */ still a comment */ SELECT 1",
  ],
  ["a leading parenthesis", "(SELECT 1) UNION (SELECT 2)"],
  ["stacked leading parentheses", "((select 1))"],
  ["select for update", "SELECT id FROM designs WHERE id = $1 FOR UPDATE"],
  ["an advisory lock", "SELECT pg_advisory_xact_lock(hashtext($1))"],
  ["set_config", "select set_config('statement_timeout', '5s', true)"],
  ["nextval", "SELECT nextval('design_seq')"],
  ["show", "SHOW statement_timeout"],
  ["values", "VALUES (1), (2)"],
  ["begin", "BEGIN"],
  ["begin read only", "begin read only"],
  ["start transaction", "START TRANSACTION"],
  ["commit", "COMMIT"],
  ["end", "END"],
  ["rollback", "ROLLBACK"],
  ["savepoint", "savepoint sp1"],
  ["release savepoint", "release savepoint sp1"],
  ["rollback to savepoint", "rollback to savepoint sp1"],
  ["set", "SET statement_timeout = 3750"],
  ["set local", "SET LOCAL idle_in_transaction_session_timeout = 30000"],
  ["reset", "RESET statement_timeout"],
  ["lock table", "LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE"],
  ["lowercase lock table", "lock table design_files in exclusive mode"],
  ["lock without the table keyword", "LOCK designs"],
  [
    "a lock after leading comments",
    "-- serialize writers\n/* held until commit */ LOCK TABLE design_files IN EXCLUSIVE MODE",
  ],
  [
    "a lock inside a transaction block",
    "BEGIN; LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE; COMMIT",
  ],
  ["explain without analyze", "EXPLAIN SELECT * FROM designs"],
  ["explain with options but no analyze", "EXPLAIN (FORMAT JSON) SELECT 1"],
  ["a with that only selects", "WITH x AS (SELECT 1) SELECT * FROM x"],
  [
    "a with whose recursive term selects",
    "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) SELECT * FROM t",
  ],
  [
    "a transaction opening and a timeout in one string",
    "BEGIN; SET LOCAL idle_in_transaction_session_timeout = 30000",
  ],
  ["several reads", "SELECT 1; SELECT 2; SHOW search_path"],
  [
    "a write verb inside a string literal",
    "SELECT * FROM designs WHERE note = 'please delete this'",
  ],
  [
    "a write verb and a semicolon inside a string literal",
    "SELECT 'x; DELETE FROM designs'",
  ],
  ["a doubled quote inside a string literal", "SELECT 'it''s; DROP TABLE a'"],
  [
    "a write verb inside an escape string",
    "SELECT E'it\\'s; DROP TABLE a' AS note",
  ],
  ["a write verb inside a dollar-quoted body", "SELECT $$; DELETE FROM a$$"],
  ["a write verb inside a tagged dollar-quoted body", "SELECT $q$ DELETE $q$"],
  ["a bound parameter", "SELECT $1, $2"],
  ["a write verb inside a quoted identifier", 'SELECT "delete" FROM designs'],
  ["a write verb inside a line comment", "SELECT 1 -- ; DROP TABLE a"],
  ["a write verb inside a block comment", "SELECT 1 /* ; DELETE FROM a */"],
  [
    "a with that mentions a write verb only in a comment",
    "WITH x AS (SELECT 1) -- INSERT INTO a\nSELECT * FROM x",
  ],
  [
    "a with that mentions a write verb only in a string",
    "WITH x AS (SELECT 'update me' AS note) SELECT * FROM x",
  ],
  [
    "a column that only contains a write verb",
    "WITH x AS (SELECT 1 AS updated_at) SELECT updated_at FROM x",
  ],
];

const writes: Array<[string, unknown]> = [
  ["insert", "INSERT INTO designs (id) VALUES ($1)"],
  ["lowercase insert", "insert into designs (id) values ($1)"],
  ["update", "UPDATE designs SET title = $1 WHERE id = $2"],
  ["delete", "DELETE FROM designs WHERE id = $1"],
  ["merge", "MERGE INTO designs USING src ON true WHEN MATCHED THEN DELETE"],
  ["truncate", "TRUNCATE designs"],
  ["copy", "COPY designs FROM STDIN"],
  ["create table", "CREATE TABLE IF NOT EXISTS designs (id TEXT)"],
  ["alter table", "ALTER TABLE designs ADD COLUMN note TEXT"],
  ["drop table", "DROP TABLE designs"],
  ["call", "CALL refresh_designs()"],
  ["do", "DO $$ BEGIN PERFORM 1; END $$"],
  ["execute", "EXECUTE prepared_write"],
  ["explain analyze", "EXPLAIN ANALYZE SELECT 1"],
  ["explain with an analyze option", "EXPLAIN (ANALYZE, BUFFERS) SELECT 1"],
  ["explain analyse", "EXPLAIN ANALYSE DELETE FROM designs"],
  ["select into", "SELECT * INTO backup FROM designs"],
  ["finishing a prepared transaction", "COMMIT PREPARED 'tx1'"],
  ["rolling back a prepared transaction", "ROLLBACK PREPARED 'tx1'"],
  [
    "a leading comment before a write",
    "-- note\n/* more */ DELETE FROM designs",
  ],
  [
    "a with whose common table expression inserts",
    "WITH x AS (INSERT INTO designs (id) VALUES ($1) RETURNING *) SELECT * FROM x",
  ],
  [
    "a with whose common table expression updates",
    "with x as (update designs set title = $1 returning id) select id from x",
  ],
  [
    "a with whose common table expression deletes",
    "WITH x AS (DELETE FROM designs RETURNING id) SELECT id FROM x",
  ],
  [
    "a with whose common table expression merges",
    "WITH x AS (MERGE INTO a USING b ON true WHEN MATCHED THEN DELETE RETURNING 1) SELECT * FROM x",
  ],
  [
    "a with that inserts after its selects",
    "WITH x AS (SELECT 1) INSERT INTO designs SELECT * FROM x",
  ],
  [
    "a with that locks rows, which it cannot tell from a writing one",
    "WITH x AS (SELECT 1) SELECT * FROM x FOR UPDATE",
  ],
  [
    "a backslash that does not escape a quote in a standard string",
    "SELECT 'a\\'; DELETE FROM designs",
  ],
  [
    "a lock in a multi-statement string that also inserts",
    "lock table design_files in exclusive mode; INSERT INTO design_files (id) VALUES ($1)",
  ],
  [
    "a lock that follows a write",
    "UPDATE designs SET title = $1; LOCK TABLE designs IN EXCLUSIVE MODE",
  ],
  [
    "a read followed by a write",
    "SELECT 1; INSERT INTO designs (id) VALUES ('a')",
  ],
  ["a write followed by a read", "DELETE FROM designs; SELECT 1"],
  [
    "a write hidden behind a comment-looking string",
    "SELECT '--'; DELETE FROM designs",
  ],
  [
    "a write after a semicolon that follows a string",
    "SELECT 'a'; UPDATE designs SET x = 1",
  ],
  [
    "a transaction block around a write",
    "BEGIN; INSERT INTO designs (id) VALUES ('a'); COMMIT",
  ],
  ["a write in a lowercase second statement", "select 1; delete from designs"],
  ["an unterminated string", "SELECT 'oops"],
  ["an unterminated quoted identifier", 'SELECT "oops'],
  ["an unterminated block comment", "SELECT 1 /* never closed"],
  ["an unterminated nested block comment", "SELECT 1 /* a /* b */"],
  ["an unterminated dollar quote", "SELECT $$ never closed"],
  ["an empty string", ""],
  ["whitespace only", "  \n\t"],
  ["comments only", "-- nothing\n/* here */"],
  ["semicolons only", ";;"],
  ["an unknown verb", "VACUUM designs"],
  ["text that does not start with a verb", "123"],
  ["undefined", undefined],
  ["null", null],
  ["an object", { sql: "SELECT 1" }],
  ["a number", 1],
];

describe("sqlMayWrite", () => {
  it.each(reads)("reads: %s", (_name, sql) => {
    expect(sqlMayWrite(sql)).toBe(false);
  });

  it.each(writes)("may write: %s", (_name, sql) => {
    expect(sqlMayWrite(sql)).toBe(true);
  });

  it("does not take a dollar-quote opener out of an identifier or a parameter", () => {
    expect(sqlMayWrite("SELECT a$$b FROM t; SELECT 1")).toBe(false);
    expect(sqlMayWrite("SELECT $1$2")).toBe(false);
  });

  it("reads a statement the same whatever its letter case", () => {
    for (const verb of ["delete", "DELETE", "DeLeTe"]) {
      expect(sqlMayWrite(`${verb} FROM designs`)).toBe(true);
    }
    for (const verb of ["select", "SELECT", "SeLeCt"]) {
      expect(sqlMayWrite(`${verb} 1`)).toBe(false);
    }
  });
});
