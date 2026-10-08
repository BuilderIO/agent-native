import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  runQuery: vi.fn(),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));

vi.mock("./bigquery", () => ({
  runQuery: mocks.runQuery,
}));

import { runDashboardPanelQuery } from "./dashboard-panel-query";

describe("dashboard-panel-query: BigQuery source", () => {
  beforeEach(() => {
    mocks.resolveCredential.mockReset().mockResolvedValue("configured");
    mocks.runQuery.mockReset().mockResolvedValue({ rows: [], schema: [] });
  });

  it("passes refresh and cancellation controls to the BigQuery runner", async () => {
    const signal = new AbortController().signal;

    await runDashboardPanelQuery({
      source: "bigquery",
      query: "SELECT 1",
      ctx: { userEmail: "alice@example.com", orgId: "org-1" },
      forceRefresh: true,
      signal,
    });

    expect(mocks.runQuery).toHaveBeenCalledWith("SELECT 1", {
      forceRefresh: true,
      signal,
    });
  });
});
