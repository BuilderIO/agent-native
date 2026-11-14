import { afterAll, describe, expect, it } from "vitest";

import { dbExecQueryBudget, hasExplicitDbTimeout } from "./client.js";
import { closeDbExec, createDbExec, sql, withSqlBudget } from "./index.js";

describe("budgeted SQL execution", () => {
  afterAll(async () => {
    await closeDbExec();
  });
  it("executes literal and bound question marks through PGlite without changing marker positions", async () => {
    const query = withSqlBudget(
      sql`SELECT '?'::text AS literal, ${sql.value("?")}::text AS parameter`,
      { timeoutMs: 4000, maxAttempts: 1 },
    );
    expect(dbExecQueryBudget(query)).toEqual({
      timeoutMs: 4000,
      maxAttempts: 1,
    });
    expect(hasExplicitDbTimeout(query)).toBe(true);
    const db = await createDbExec({ url: "pglite:memory" });
    try {
      const result = await db.execute(query);
      expect(result.rows).toEqual([{ literal: "?", parameter: "?" }]);
    } finally {
      await db.close?.();
    }
  });
});
