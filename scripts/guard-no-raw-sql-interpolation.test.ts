import { describe, expect, it } from "vitest";

import { findRawSqlInterpolationViolations } from "./guard-no-raw-sql-interpolation.js";

const FILE = "packages/core/src/example.ts";

function source(lines: string[]): string {
  return lines.join("\n");
}

describe("raw SQL interpolation guard", () => {
  it("finds interpolated SQL template properties on added lines", () => {
    const text = source([
      "const query = {",
      "  sql: `SELECT * FROM records WHERE id = ${recordId}`",
      "};",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "sql: `SELECT * FROM records WHERE id = ${recordId}`",
        },
      ],
    );
  });

  it("catches a multiline template when only its interpolation line was added", () => {
    const text = source([
      "const query = {",
      "  sql: `SELECT id FROM records",
      "    WHERE workspace_id =",
      "      ${workspaceId}`",
      "};",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([4])),
    ).toHaveLength(1);
  });

  it("finds interpolated templates passed directly to execute", () => {
    const text = source([
      "const database = getDbExec();",
      "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      "execute(`DELETE FROM records WHERE id = ${recordId}`);",
      'database["execute"](`UPDATE records SET active = ${active}`);',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3, 4])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet:
          "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
      {
        file: FILE,
        line: 3,
        snippet: "execute(`DELETE FROM records WHERE id = ${recordId}`);",
      },
      {
        file: FILE,
        line: 4,
        snippet:
          'database["execute"](`UPDATE records SET active = ${active}`);',
      },
    ]);
  });

  it("finds interpolated templates assigned to a variable before execute", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "const alias = statement;",
      "database.execute(alias);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 1,
        snippet:
          "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      },
    ]);
  });

  it("finds a new execute call that reuses an existing interpolated template", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "database.execute(statement);",
        },
      ],
    );
  });

  it("finds an interpolated template aliased into a sql property", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "const query = { sql: statement };",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "const query = { sql: statement };",
        },
      ],
    );
  });

  it("tracks interpolated templates assigned after variable declaration", () => {
    const text = source([
      'let statement = "";',
      "statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet: "statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      },
    ]);
  });

  it("catches interpolated tagged templates outside the SQL fragment tag", () => {
    const text = source([
      "const statement = String.raw`SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
      "database.execute(String.raw`DELETE FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 1,
        snippet:
          "const statement = String.raw`SELECT * FROM records WHERE id = ${recordId}`;",
      },
      {
        file: FILE,
        line: 3,
        snippet:
          "database.execute(String.raw`DELETE FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("tracks raw SQL string concatenation and local helper returns", () => {
    const concatenated = source([
      'const statement = "SELECT * FROM records WHERE id = " + recordId;',
      "database.execute(statement);",
    ]);
    const helper = source([
      "function buildQuery(recordId: string) {",
      "  return `SELECT * FROM records WHERE id = ${recordId}`;",
      "}",
      "database.execute(buildQuery(recordId));",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, concatenated, new Set([1, 2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, helper, new Set([1, 2, 3, 4])),
    ).toHaveLength(1);
  });

  it("finds shorthand and computed sql properties", () => {
    const text = source([
      "const sql = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute({ sql });",
      'database.execute({ ["sql"]: sql });',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet: "database.execute({ sql });",
      },
      {
        file: FILE,
        line: 3,
        snippet: 'database.execute({ ["sql"]: sql });',
      },
    ]);
  });

  it("does not carry taint past a later static assignment", () => {
    const text = source([
      "let statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      'statement = "SELECT * FROM records";',
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([]);
  });

  it("leaves tagged SQL fragments to the tag's binding rules", () => {
    const text = source([
      'import { sql } from "./db/sql.js";',
      "const statement = sql`SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
      "database.execute(sql.in([recordId]));",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3, 4])),
    ).toEqual([]);
  });

  it("ignores unchanged SQL templates and added lines outside the property", () => {
    const text = source([
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
      "const label = 'changed';",
      "const safe = { sql: `SELECT * FROM records` };",
      "const other = { query: `SELECT ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3, 4])),
    ).toEqual([]);
  });

  it("ignores SQL-looking strings, comments, and non-interpolated templates", () => {
    const text = source([
      "// sql: `SELECT ${recordId}`",
      'const label = "sql: `SELECT ${recordId}`";',
      "const query = { sql: `SELECT * FROM records` };",
      'const queryText = { sql: "SELECT ${recordId}" };',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3, 4])),
    ).toEqual([]);
  });

  it("accepts a reasoned pragma above, on, or inside the property", () => {
    const examples = [
      source([
        "// raw-sql-ok: supports reviewed legacy filter clauses",
        "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
      ]),
      source([
        "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` }; // raw-sql-ok: compatibility query",
      ]),
      source([
        "const query = {",
        "  sql: `SELECT * FROM records",
        "-- raw-sql-ok: fixed operator list is reviewed",
        "    WHERE id = ${recordId}`",
        "};",
      ]),
    ];

    for (const text of examples) {
      const addedLines = new Set(text.split("\n").map((_, index) => index + 1));
      expect(findRawSqlInterpolationViolations(FILE, text, addedLines)).toEqual(
        [],
      );
    }
  });

  it("does not accept an empty pragma reason", () => {
    const text = source([
      "// raw-sql-ok:",
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toHaveLength(1);
  });

  it("does not treat generated source as application SQL", () => {
    const text = "const query = { sql: `SELECT ${recordId}` };";

    expect(
      findRawSqlInterpolationViolations(
        "packages/core/src/.generated/query.ts",
        text,
        new Set([1]),
      ),
    ).toEqual([]);
  });
});
