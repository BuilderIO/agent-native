import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  updateScheduledJobForOwner: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/jobs.js", () => ({
  updateScheduledJobForOwner: mocks.updateScheduledJobForOwner,
}));

import action from "./update-scheduled-job";

describe("update-scheduled-job action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
  });

  it("updates an owner-scoped job and resets it to pending", async () => {
    const job = {
      id: "job-1",
      status: "pending",
      runAt: 1_800_000_000_000,
    };
    mocks.updateScheduledJobForOwner.mockResolvedValue(job);

    await expect(
      action.run({ id: "job-1", runAt: job.runAt }),
    ).resolves.toEqual(job);
    expect(mocks.updateScheduledJobForOwner).toHaveBeenCalledWith(
      "owner@example.com",
      "job-1",
      job.runAt,
    );
  });

  it("validates future dates before writing", async () => {
    await expect(
      action.run({ id: "job-1", runAt: Date.now() - 1 }),
    ).rejects.toThrow("future timestamp");
    expect(mocks.updateScheduledJobForOwner).not.toHaveBeenCalled();
  });

  it("rejects jobs that are not visible to the owner", async () => {
    mocks.updateScheduledJobForOwner.mockResolvedValue(null);

    await expect(
      action.run({ id: "job-1", runAt: Date.now() + 60_000 }),
    ).rejects.toThrow("Scheduled job not found");
  });
});
