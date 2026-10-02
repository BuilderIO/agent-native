import { describe, expect, it } from "vitest";

import { agentSqlTypeNames } from "./analysis.js";
import { lexAgentSql } from "./lexer.js";

function typeNames(sql: string): Set<string> {
  return agentSqlTypeNames(lexAgentSql(sql, { dialect: "postgres" }));
}

describe("agentSqlTypeNames", () => {
  it.each([
    "SELECT '(x)'::notes",
    "SELECT '(x)'::notes[]",
    "SELECT '(x)'::archive /* gap */ . notes",
    "SELECT CAST('(x)' AS notes)",
    "SELECT CAST(CAST('(x)' AS text) AS notes)",
    "SELECT notes('(x)') AS body",
    "SELECT notes '(x)'",
    "SELECT notes(10) '(x)'",
    "SELECT CAST((SELECT id AS body FROM source) AS notes)",
  ])("finds conversions in %s", (sql) => {
    expect(typeNames(sql)).toContain("notes");
  });

  it("preserves quoted type names", () => {
    expect(typeNames('SELECT CAST(1 AS "NoteValue")')).toContain("NoteValue");
  });

  it.each([
    "SELECT notes.id, notes.body FROM notes",
    "SELECT id AS notes FROM notes",
    "INSERT INTO notes (id, body) VALUES ('a', 'x')",
    "INSERT INTO notes AS notes (id, body) VALUES ('a', 'x')",
    "WITH notes(id, body) AS (SELECT id, body FROM source) SELECT * FROM notes",
    "WITH notes(id) AS MATERIALIZED (SELECT id FROM source) SELECT * FROM notes",
    "SELECT * FROM source AS notes(id, body)",
  ])("keeps declarations and ordinary row names out of %s", (sql) => {
    expect(typeNames(sql)).not.toContain("notes");
  });

  it("ignores conversion text inside literals and comments", () => {
    expect(typeNames("SELECT '1::notes' /* CAST(1 AS notes) */")).not.toContain(
      "notes",
    );
  });
});
