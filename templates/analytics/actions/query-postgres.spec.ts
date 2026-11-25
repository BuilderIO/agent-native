import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  runDashboardPanelQuery: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));
vi.mock("../server/lib/dashboard-panel-query", () => ({
  runDashboardPanelQuery: mocks.runDashboardPanelQuery,
}));

const {
  default: action,
  boundPostgresSql,
  QUERY_POSTGRES_MAX_ROWS,
} = await import("./query-postgres");

const ctx = { userEmail: "alice@example.com", orgId: null };

describe("query-postgres", () => {
  beforeEach(() => {
    mocks.getCredentialContext.mockReset().mockReturnValue(ctx);
    mocks.runDashboardPanelQuery.mockReset();
  });

  it("rejects non-read-only SQL before touching the database", async () => {
    await expect(
      action.run({ query: "DELETE FROM users" }, {} as never),
    ).rejects.toThrow();
    expect(mocks.runDashboardPanelQuery).not.toHaveBeenCalled();
  });

  it("wraps the statement with a row cap and survives trailing comments", () => {
    const sql = boundPostgresSql("SELECT 1; -- note");
    expect(sql).toContain("LIMIT 5001");
    expect(sql).toMatch(/\n\) AS /);
  });

  it("runs on the postgres source and flags truncation", async () => {
    const rows = Array.from(
      { length: QUERY_POSTGRES_MAX_ROWS + 1 },
      (_, i) => ({
        i,
      }),
    );
    mocks.runDashboardPanelQuery.mockResolvedValue({
      rows,
      schema: [{ name: "i", type: "number" }],
    });
    const result = (await action.run(
      { query: "SELECT i FROM t" },
      {} as never,
    )) as { truncated: boolean; rows: unknown[] };
    expect(mocks.runDashboardPanelQuery.mock.calls[0][0].source).toBe(
      "postgres",
    );
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(QUERY_POSTGRES_MAX_ROWS);
  });
});
