import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  isConnected: vi.fn(),
  gmailBatchModifyByAccount: vi.fn(),
  markRead: vi.fn(),
  markAllUnreadReadForAccount: vi.fn(),
  markAllLocalUnreadRead: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  gmailBatchModifyByAccount: mocks.gmailBatchModifyByAccount,
  markAllUnreadReadForAccount: mocks.markAllUnreadReadForAccount,
}));

vi.mock("../server/lib/email-state.js", () => ({
  markRead: mocks.markRead,
  markAllLocalUnreadRead: mocks.markAllLocalUnreadRead,
}));

import action, { MARK_READ_DESCRIPTION } from "./mark-read";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.isConnected.mockResolvedValue(false);
  mocks.markRead.mockResolvedValue({ id: "email-1", isRead: true });
});

describe("mark-read action", () => {
  it("teaches agents to use one bulk call instead of a thread loop", () => {
    expect(MARK_READ_DESCRIPTION).toContain('scope "all-unread"');
    expect(MARK_READ_DESCRIPTION).toContain("Never loop mark-thread-read");
  });

  it("keeps the legacy explicit-ID path working", async () => {
    const result = await action.run({
      id: "email-1",
      accountEmail: ACCOUNT,
    });

    expect(mocks.markRead).toHaveBeenCalledWith({
      id: "email-1",
      ownerEmail: OWNER,
      isRead: true,
      accountEmail: ACCOUNT,
    });
    expect(mocks.markAllUnreadReadForAccount).not.toHaveBeenCalled();
    expect(mocks.markAllLocalUnreadRead).not.toHaveBeenCalled();
    expect(result).toBe("Marked 1/1 email(s) as read");
  });

  it.each([[{ id: "email-1", scope: "all-unread" }], [{}]])(
    "rejects %s selector conflicts before any write",
    async (args) => {
      await expect(action.run(args as any)).rejects.toThrow();

      expect(mocks.markRead).not.toHaveBeenCalled();
      expect(mocks.markAllUnreadReadForAccount).not.toHaveBeenCalled();
      expect(mocks.markAllLocalUnreadRead).not.toHaveBeenCalled();
      expect(mocks.writeAppState).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid scope before legacy ID writes", async () => {
    await expect(
      action.run({ id: "email-1", scope: "something-else" } as any),
    ).rejects.toThrow(/scope/i);

    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("requires a single account for all-unread", async () => {
    await expect(action.run({ scope: "all-unread" } as any)).rejects.toThrow(
      "accountEmail",
    );

    expect(mocks.isConnected).not.toHaveBeenCalled();
  });

  it.each([[{ accountEmails: ACCOUNT }], [{ unread: true }]])(
    "rejects unsupported all-unread input: %s",
    async (extra) => {
      await expect(
        action.run({
          scope: "all-unread",
          accountEmail: ACCOUNT,
          ...extra,
        } as any),
      ).rejects.toThrow();

      expect(mocks.markRead).not.toHaveBeenCalled();
      expect(mocks.markAllUnreadReadForAccount).not.toHaveBeenCalled();
      expect(mocks.markAllLocalUnreadRead).not.toHaveBeenCalled();
    },
  );

  it("uses Gmail bulk mark-read with normalized exclusions and returns its structured result", async () => {
    const bulkResult = {
      mode: "all-unread",
      accountEmail: ACCOUNT,
      matchedMessages: 6,
      matchedThreads: 4,
      excludedMessages: 2,
      excludedThreads: 2,
      changedMessages: 4,
      batchCount: 1,
      failures: [],
      remainingUnreadMessages: 0,
      remainingUnreadThreads: 0,
      remainingProtectedMessages: 2,
      remainingProtectedThreads: 2,
      unexpectedUnreadMessages: 0,
      unexpectedUnreadThreads: 0,
      verificationComplete: true,
    };
    mocks.isConnected.mockResolvedValue(true);
    mocks.markAllUnreadReadForAccount.mockResolvedValue(bulkResult);

    const result = await action.run({
      scope: "all-unread",
      accountEmail: ACCOUNT,
      excludeThreadIds: " thread-a, ,thread-b ",
    } as any);

    expect(mocks.markAllUnreadReadForAccount).toHaveBeenCalledWith({
      ownerEmail: OWNER,
      accountEmail: ACCOUNT,
      excludeThreadIds: ["thread-a", "thread-b"],
    });
    expect(result).toEqual(expect.objectContaining(bulkResult));
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("uses the local bulk helper when Gmail is disconnected", async () => {
    const bulkResult = {
      mode: "all-unread",
      accountEmail: ACCOUNT,
      matchedMessages: 3,
      matchedThreads: 3,
      excludedMessages: 0,
      excludedThreads: 0,
      changedMessages: 3,
      batchCount: 1,
      failures: [],
      remainingUnreadMessages: 0,
      remainingUnreadThreads: 0,
      remainingProtectedMessages: 0,
      remainingProtectedThreads: 0,
      unexpectedUnreadMessages: 0,
      unexpectedUnreadThreads: 0,
      verificationComplete: true,
    };
    mocks.markAllLocalUnreadRead.mockResolvedValue(bulkResult);

    const result = await action.run({
      scope: "all-unread",
      accountEmail: ACCOUNT,
      excludeThreadIds: "thread-local",
    } as any);

    expect(mocks.markAllLocalUnreadRead).toHaveBeenCalledWith({
      ownerEmail: OWNER,
      accountEmail: ACCOUNT,
      excludeThreadIds: ["thread-local"],
    });
    expect(mocks.markAllUnreadReadForAccount).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining(bulkResult));
  });

  it("throws concrete counts when bulk verification is incomplete", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.markAllUnreadReadForAccount.mockResolvedValue({
      mode: "all-unread",
      accountEmail: ACCOUNT,
      matchedMessages: 12,
      matchedThreads: 10,
      excludedMessages: 2,
      excludedThreads: 2,
      changedMessages: 10,
      batchCount: 1,
      failures: [],
      remainingUnreadMessages: 2,
      remainingUnreadThreads: 2,
      remainingProtectedMessages: 0,
      remainingProtectedThreads: 0,
      unexpectedUnreadMessages: 2,
      unexpectedUnreadThreads: 2,
      verificationComplete: false,
    });

    await expect(
      action.run({ scope: "all-unread", accountEmail: ACCOUNT } as any),
    ).rejects.toThrow(/10.*2|2.*10/);
  });
});
