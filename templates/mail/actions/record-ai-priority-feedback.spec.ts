import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: mocks.putUserSetting,
}));

import action from "./record-ai-priority-feedback";

describe("record-ai-priority-feedback action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue(undefined);
    mocks.putUserSetting.mockResolvedValue(undefined);
  });

  it("keeps recent vote context and migrates the existing object format", async () => {
    mocks.getUserSetting.mockResolvedValue({
      entries: [
        {
          emailId: "old-email",
          decision: "important",
          createdAt: 10,
        },
      ],
    });

    const result = await action.run({
      emailId: "new-email",
      decision: "not-important",
      sender: "GitHub",
      subject: "Bot workflow failed",
    });

    expect(result.totalVotes).toBe(2);
    expect(result.recentVotes.at(-1)).toMatchObject({
      emailId: "new-email",
      decision: "not-important",
      sender: "GitHub",
      subject: "Bot workflow failed",
    });
    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "ai-priority-feedback",
      expect.objectContaining({ totalVotes: 2 }),
    );
  });
});
