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
