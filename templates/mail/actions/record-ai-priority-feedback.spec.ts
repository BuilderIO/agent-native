import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  mutateUserSetting: mocks.mutateUserSetting,
}));

import action from "./record-ai-priority-feedback";

describe("record-ai-priority-feedback action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.mutateUserSetting.mockImplementation(async (_email, _key, updater) =>
      updater(null),
    );
  });

  it("keeps recent vote context and migrates the existing object format", async () => {
    mocks.mutateUserSetting.mockImplementation(async (_email, _key, updater) =>
      updater({
        entries: [
          {
            emailId: "old-email",
            decision: "important",
            createdAt: 10,
          },
        ],
      }),
    );

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
    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "ai-priority-feedback",
      expect.any(Function),
    );
  });

  it("uses the latest state after a CAS retry and keeps only 500 entries", async () => {
    const stale = {
      entries: [{ emailId: "stale", decision: "important", createdAt: 1 }],
      totalVotes: 1,
    };
    const latest = {
      entries: Array.from({ length: 500 }, (_, index) => ({
        emailId: `latest-${index}`,
        decision: "important",
        createdAt: index,
      })),
      totalVotes: 1001,
    };
    let persisted: Record<string, unknown> | undefined;
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        await updater(stale);
        persisted = await updater(latest);
        return persisted;
      },
    );

    const result = await action.run({
      emailId: "new-email",
      decision: "not-important",
    });

    expect(result.totalVotes).toBe(1002);
    expect(result.recentVotes.map((vote) => vote.emailId)).toEqual([
      "latest-496",
      "latest-497",
      "latest-498",
      "latest-499",
      "new-email",
    ]);
    expect((persisted?.entries as unknown[]).length).toBe(500);
  });

  it("rejects unreadable stored feedback", async () => {
    mocks.mutateUserSetting.mockImplementation(async (_email, _key, updater) =>
      updater({ entries: [{ emailId: "missing-vote-fields" }] }),
    );

    await expect(
      action.run({ emailId: "new-email", decision: "important" }),
    ).rejects.toThrow("Stored importance feedback is unreadable.");
  });
});
