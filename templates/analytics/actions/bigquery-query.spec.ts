import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
}));

vi.mock("../server/lib/bigquery", () => ({
  runQuery: mocks.runQuery,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: vi.fn(),
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
    const result = {
      rows: [{ total: 42 }],
      totalRows: 1,
      schema: [],
      bytesProcessed: 0,
    };
    mocks.runQuery.mockResolvedValue(result);

    await expect(
      bigqueryQuery.run({ sql: "SELECT 42 AS total" }),
    ).resolves.toEqual(result);
    expect(mocks.runQuery).toHaveBeenCalledWith("SELECT 42 AS total", {
      signal: undefined,
    });
  });
});
