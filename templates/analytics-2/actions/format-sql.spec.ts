import { describe, expect, it, vi } from "vitest";

const format = vi.hoisted(() => vi.fn());
vi.mock("../server/formatter/sqlfluff.js", () => ({
  MAX_FORMAT_SQL_BYTES: 1024 * 1024,
  formatSqlWithConfig: format,
}));

import formatSql from "./format-sql.js";

const context = { caller: "frontend" as const, appId: "analytics-2" };

describe("format-sql", () => {
  it("returns the formatter's text and whether it changed", async () => {
    format.mockResolvedValueOnce({
      formattedSource: "SELECT\n  1\n",
      changed: true,
      dialect: "bigquery",
      templater: "raw",
    });
    await expect(formatSql.run({ sql: "select 1" }, context)).resolves.toEqual({
      formattedSource: "SELECT\n  1\n",
      changed: true,
    });
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "select 1",
        config: expect.stringContaining("dialect = bigquery"),
      }),
    );
  });

  it("reports unparseable SQL and an unavailable formatter as distinct failures", async () => {
    format.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "parse_error" }),
    );
    await expect(
      formatSql.run({ sql: "select (" }, context),
    ).rejects.toMatchObject({ errorCode: "sql_format_unparseable" });
    format.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "engine_error" }),
    );
    await expect(
      formatSql.run({ sql: "select 1" }, context),
    ).rejects.toMatchObject({ errorCode: "sql_format_failed" });
  });
});
