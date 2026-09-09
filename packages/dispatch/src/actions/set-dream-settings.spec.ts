import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDreamSettings: vi.fn(),
}));

vi.mock("../server/lib/dreams-store.js", () => ({
  setDreamSettings: mocks.setDreamSettings,
}));

import action from "./set-dream-settings.js";

describe("set-dream-settings action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setDreamSettings.mockImplementation(async (input) => ({
      enabled: false,
      schedule: "0 9 * * 1",
      sourceId: "all",
      sourceIds: [],
      allSources: true,
      query: null,
      limit: 8,
      sourceTimeoutMs: 30000,
      sourceConcurrency: 2,
      sourceStartStaggerMs: 250,
      threadConcurrency: 3,
      threadTimeoutMs: 8000,
      minCandidateCount: 1,
      ...input,
    }));
  });

  it("coerces numeric fields and preserves explicit clears", async () => {
    await action.run({
      enabled: true,
      schedule: "0 8 * * 2",
      sourceId: "current",
      sourceIds: [],
      allSources: false,
      query: "",
      limit: "50",
      sourceTimeoutMs: "60000",
      sourceConcurrency: "8",
      sourceStartStaggerMs: "5000",
      threadConcurrency: "10",
      threadTimeoutMs: "30000",
      minCandidateCount: "0",
    } as any);

    expect(mocks.setDreamSettings).toHaveBeenCalledWith({
      enabled: true,
      schedule: "0 8 * * 2",
      sourceId: "current",
      sourceIds: [],
      allSources: false,
      query: "",
      limit: 50,
      sourceTimeoutMs: 60000,
      sourceConcurrency: 8,
      sourceStartStaggerMs: 5000,
      threadConcurrency: 10,
      threadTimeoutMs: 30000,
      minCandidateCount: 0,
    });
  });

  it("rejects out-of-range numeric settings before writing", async () => {
    await expect(action.run({ limit: "0" } as any)).rejects.toThrow(
      /Invalid action parameters/,
    );
    await expect(
      action.run({ sourceTimeoutMs: "60001" } as any),
    ).rejects.toThrow(/Invalid action parameters/);
    await expect(
      action.run({ threadTimeoutMs: "30001" } as any),
    ).rejects.toThrow(/Invalid action parameters/);

    expect(mocks.setDreamSettings).not.toHaveBeenCalled();
  });
});
