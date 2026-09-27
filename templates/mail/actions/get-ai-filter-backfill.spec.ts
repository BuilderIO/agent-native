import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  readMailAiFilterBackfill: vi.fn(),
  listRecentMailAiFilterBackfills: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/ai-filter-backfill.js", () => ({
  readMailAiFilterBackfill: mocks.readMailAiFilterBackfill,
  listRecentMailAiFilterBackfills: mocks.listRecentMailAiFilterBackfills,
}));

import action from "./get-ai-filter-backfill";

describe("get-ai-filter-backfill action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
  });

  it("serves status reads through a read-only GET action", async () => {
    const status = { runId: "run-1", status: "running" };
    mocks.readMailAiFilterBackfill.mockResolvedValue(status);

    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    await expect(
      action.run({ operation: "status", runId: "run-1" }),
    ).resolves.toBe(status);
    expect(mocks.readMailAiFilterBackfill).toHaveBeenCalledWith(
      "owner@example.com",
      "run-1",
    );
    expect(mocks.listRecentMailAiFilterBackfills).not.toHaveBeenCalled();
  });
});
