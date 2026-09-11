import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  isConnected: vi.fn(),
  gmailBatchModifyByAccount: vi.fn(),
  markRead: vi.fn(),
  markAllUnreadReadForAccount: vi.fn(),
  markAllLocalUnreadRead: vi.fn(),
  resolveMutationAccounts: vi.fn(),
  track: vi.fn(),
  syncInboxLabelDeltaForTargets: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  gmailBatchModifyByAccount: mocks.gmailBatchModifyByAccount,
  markAllUnreadReadForAccount: mocks.markAllUnreadReadForAccount,
}));

vi.mock("../server/lib/email-state.js", () => ({
  markRead: mocks.markRead,
  markAllLocalUnreadRead: mocks.markAllLocalUnreadRead,
  resolveMutationAccounts: mocks.resolveMutationAccounts,
}));

vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDeltaForTargets: mocks.syncInboxLabelDeltaForTargets,
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
  // Default: every target already carries an explicit accountEmail in these
  // tests, so resolution is a pure passthrough (matches the real resolver's
  // behavior when accountEmail is already set — see email-state.spec.ts for
  // the actual resolution-rule coverage).
  mocks.resolveMutationAccounts.mockImplementation(
    async (
      _owner: string,
      targets: Array<{ id: string; accountEmail?: string }>,
    ) => ({
      resolved: targets
        .filter((t) => t.accountEmail)
        .map((t) => ({ ...t, accountEmail: t.accountEmail! })),
      unresolved: targets
        .filter((t) => !t.accountEmail)
        .map((t) => ({ id: t.id, error: "Cannot determine account" })),
    }),
  );
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

  it("records partial explicit triage failures", async () => {
    mocks.markRead.mockImplementation(async ({ id }) => {
      if (id === "email-2") throw new Error("provider unavailable");
      return { id, isRead: true };
    });

    const result = await action.run({
      id: "email-1,email-2",
      accountEmail: ACCOUNT,
    });

    expect(result).toBe("Marked 1/2 email(s) as read");
    expect(mocks.track).toHaveBeenCalledWith(
      "inbox_triaged",
      expect.objectContaining({
        items_triaged: 1,
        succeeded: false,
        partial: true,
        failed_count: 1,
      }),
      undefined,
    );
  });

  it("syncs the inbox store from the Gmail bulk-modify path, grouped by account", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.gmailBatchModifyByAccount.mockResolvedValue({
      succeeded: ["email-1", "email-2"],
      failed: [],
    });

    await action.run({
      id: "email-1,email-2",
      accountEmails: "acct-a@example.com,acct-b@example.com",
    });

    // Passes the SAME resolved targets to the Gmail mutation and the store
    // mirror (see resolveMutationAccounts in email-state.ts) — the two must
    // never group by different accounts.
    expect(mocks.gmailBatchModifyByAccount).toHaveBeenCalledWith(
      OWNER,
      [
        { id: "email-1", accountEmail: "acct-a@example.com" },
        { id: "email-2", accountEmail: "acct-b@example.com" },
      ],
      undefined,
      ["UNREAD"],
    );
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [
        { id: "email-1", accountEmail: "acct-a@example.com" },
        { id: "email-2", accountEmail: "acct-b@example.com" },
      ],
      { add: undefined, remove: ["UNREAD"], scope: "message" },
    );
  });

  it("reports an unresolvable target as a failure instead of guessing its account", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.resolveMutationAccounts.mockResolvedValue({
      resolved: [{ id: "email-1", accountEmail: "acct-a@example.com" }],
      unresolved: [
        { id: "email-2", error: "Cannot determine which connected account" },
      ],
    });
    mocks.gmailBatchModifyByAccount.mockResolvedValue({
      succeeded: ["email-1"],
      failed: [],
    });

    const result = await action.run({ id: "email-1,email-2" });

    expect(result).toBe("Marked 1/2 email(s) as read");
    expect(mocks.gmailBatchModifyByAccount).toHaveBeenCalledWith(
      OWNER,
      [{ id: "email-1", accountEmail: "acct-a@example.com" }],
      undefined,
      ["UNREAD"],
    );
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
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("refreshes the UI even when a bulk helper throws after a mutation", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.markAllUnreadReadForAccount.mockRejectedValue(
      new Error("provider verification crashed"),
    );

    await expect(
      action.run({ scope: "all-unread", accountEmail: ACCOUNT } as any),
    ).rejects.toThrow("provider verification crashed");
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });
});
