import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimant: "recipient@example.test",
  releaseClaimedAi: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mocks.claimant,
}));
vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    releaseClaimedAi: (...args: unknown[]) => mocks.releaseClaimedAi(...args),
  },
}));

import action from "./release-transactional-email-ai-requests";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimant = "recipient@example.test";
  mocks.releaseClaimedAi.mockImplementation(async (jobId: string) => ({
    logicalKey: jobId,
  }));
});

describe("release-transactional-email-ai-requests", () => {
  it("is a signed-in UI-only action", () => {
    expect(action.agentTool).toBe(false);
  });

  it("releases each requested claim for the current claimant", async () => {
    await expect(action.run({ jobIds: ["job-1", "job-2"] })).resolves.toEqual({
      releasedJobIds: ["job-1", "job-2"],
    });
    expect(mocks.releaseClaimedAi).toHaveBeenNthCalledWith(
      1,
      "job-1",
      "recipient@example.test",
    );
    expect(mocks.releaseClaimedAi).toHaveBeenNthCalledWith(
      2,
      "job-2",
      "recipient@example.test",
    );
  });
});
