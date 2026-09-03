import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
}));

vi.mock("../server/lib/bigquery", () => ({
  runQuery: mocks.runQuery,
}));

const { default: bigqueryQuery } = await import("./bigquery-query");

describe("bigquery-query compatibility action", () => {
  beforeEach(() => {
    mocks.runQuery.mockReset();
  });

  it("keeps the legacy extension route HTTP-callable without adding an agent tool", () => {
    expect(bigqueryQuery.agentTool).toBe(false);
    expect(bigqueryQuery.http).toEqual({ method: "POST" });
    expect(bigqueryQuery.readOnly).toBe(true);
    expect(bigqueryQuery.toolCallable).toBe(true);
  });

  it("delegates to the canonical BigQuery implementation", async () => {
    mocks.runQuery.mockResolvedValue([{ total: 42 }]);

    await expect(
      bigqueryQuery.run({ sql: "SELECT 42 AS total" }),
    ).resolves.toEqual([{ total: 42 }]);
    expect(mocks.runQuery).toHaveBeenCalledWith("SELECT 42 AS total", {
      signal: undefined,
    });
  });
});
