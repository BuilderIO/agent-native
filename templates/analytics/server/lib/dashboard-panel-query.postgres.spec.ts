import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  runQueryWithColumns: vi.fn(),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));

vi.mock("./postgres", () => ({
  runQueryWithColumns: mocks.runQueryWithColumns,
}));

import {
  isDashboardPanelSource,
  normalizeDashboardPanelQuery,
  runDashboardPanelQuery,
} from "./dashboard-panel-query";

const ctx = { userEmail: "alice@example.com", orgId: "org-1" };

describe("dashboard-panel-query: PostgreSQL source", () => {
  beforeEach(() => {
    mocks.resolveCredential.mockReset().mockResolvedValue("postgres://x");
    mocks.runQueryWithColumns.mockReset();
  });

  it("is a recognised panel source that takes SQL text", () => {
    expect(isDashboardPanelSource("postgres")).toBe(true);
    expect(normalizeDashboardPanelQuery("postgres", "SELECT 1")).toBe(
      "SELECT 1",
    );
  });

  it("converts int8 and numeric strings to numbers so pie charts render", async () => {
    mocks.runQueryWithColumns.mockResolvedValue({
      rows: [
        { plan: "pro", n: "42", revenue: "12.50", big: "9007199254740993" },
      ],
      columns: [
        { name: "plan", type: 25 },
        { name: "n", type: 20 },
        { name: "revenue", type: 1700 },
        { name: "big", type: 20 },
      ],
    });

    const result = await runDashboardPanelQuery({
      source: "postgres",
      query: "SELECT plan, count(*) n FROM t GROUP BY 1",
      ctx,
    });

    expect(result).toEqual({
      rows: [
        {
          plan: "pro",
          n: 42,
          revenue: 12.5,
          big: "9007199254740993",
        },
      ],
      schema: [
        { name: "plan", type: "string" },
        { name: "n", type: "number" },
        { name: "revenue", type: "number" },
        { name: "big", type: "number" },
      ],
    });
  });

  it("reports a missing POSTGRES_URL instead of querying", async () => {
    mocks.resolveCredential.mockResolvedValue(undefined);

    const result = await runDashboardPanelQuery({
      source: "postgres",
      query: "SELECT 1",
      ctx,
    });

    expect(result).toMatchObject({
      error: "missing_api_key",
      key: "POSTGRES_URL",
    });
    expect(mocks.runQueryWithColumns).not.toHaveBeenCalled();
  });
});
