import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  track: vi.fn(),
  archiveEmail: vi.fn(),
  resolveMutationAccounts: vi.fn(),
  gmailBatchArchiveByAccount: vi.fn(),
  isConnected: vi.fn(),
  syncInboxLabelDeltaForTargets: vi.fn(),
  invalidateThreadCache: vi.fn(),
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

vi.mock("../server/lib/email-state.js", () => ({
  archiveEmail: mocks.archiveEmail,
  resolveMutationAccounts: mocks.resolveMutationAccounts,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  gmailBatchArchiveByAccount: mocks.gmailBatchArchiveByAccount,
  isConnected: mocks.isConnected,
}));

vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDeltaForTargets: mocks.syncInboxLabelDeltaForTargets,
}));

vi.mock("../server/lib/thread-cache.js", () => ({
  invalidateThreadCache: mocks.invalidateThreadCache,
}));

import action from "./archive-email";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.isConnected.mockResolvedValue(true);
  mocks.resolveMutationAccounts.mockImplementation(
    async (_owner: string, targets: Array<Record<string, unknown>>) => ({
      resolved: targets.map((target) => ({ ...target, accountEmail: ACCOUNT })),
      unresolved: [],
    }),
  );
  mocks.gmailBatchArchiveByAccount.mockResolvedValue({
    succeeded: ["message-1", "message-2"],
    failed: [],
    remaining: [],
    threadIdsByTarget: {
      "message-1": "thread-1",
      "message-2": "thread-2",
    },
    removeLabelIdsByAccount: { [ACCOUNT]: ["INBOX", "Label_projects"] },
  });
});

describe("archive-email action", () => {
  it("archives one selected connected thread through the thread-aware batch path", async () => {
    mocks.gmailBatchArchiveByAccount.mockResolvedValueOnce({
      succeeded: ["message-new"],
      failed: [],
      remaining: [],
      threadIdsByTarget: { "message-new": "thread-1" },
      removeLabelIdsByAccount: { [ACCOUNT]: ["INBOX"] },
    });

    const result = await action.run({
      id: "message-new",
      threadId: "thread-1",
      accountEmail: ACCOUNT,
    });

    expect(result).toBe("Archived 1 email(s) successfully");
    expect(mocks.gmailBatchArchiveByAccount).toHaveBeenCalledWith(
      OWNER,
      [{ id: "message-new", threadId: "thread-1", accountEmail: ACCOUNT }],
      undefined,
    );
    expect(mocks.archiveEmail).not.toHaveBeenCalled();
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [{ id: "message-new", threadId: "thread-1", accountEmail: ACCOUNT }],
      { remove: ["INBOX"] },
    );
  });

  it("batches label-view archives and mirrors the resolved label ID", async () => {
    const result = await action.run({
      id: "message-1,message-2",
      threadIds: "thread-1,thread-2",
      accountEmails: `${ACCOUNT},${ACCOUNT}`,
      removeLabel: "Projects",
    });

    expect(result).toBe("Archived 2 email(s) successfully");
    expect(mocks.gmailBatchArchiveByAccount).toHaveBeenCalledWith(
      OWNER,
      [
        {
          id: "message-1",
          threadId: "thread-1",
          accountEmail: ACCOUNT,
        },
        {
          id: "message-2",
          threadId: "thread-2",
          accountEmail: ACCOUNT,
        },
      ],
      "Projects",
    );
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [
        {
          id: "message-1",
          threadId: "thread-1",
          accountEmail: ACCOUNT,
        },
        {
          id: "message-2",
          threadId: "thread-2",
          accountEmail: ACCOUNT,
        },
      ],
      { remove: ["INBOX", "Label_projects"] },
    );
    expect(mocks.archiveEmail).not.toHaveBeenCalled();
    expect(mocks.invalidateThreadCache).toHaveBeenCalledTimes(2);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("reports failed targets while syncing only successful archives", async () => {
    mocks.gmailBatchArchiveByAccount.mockResolvedValueOnce({
      succeeded: ["message-1"],
      failed: [{ id: "message-2", error: "batchModify failed" }],
      remaining: [],
      threadIdsByTarget: {
        "message-1": "thread-1",
        "message-2": "thread-2",
      },
      removeLabelIdsByAccount: { [ACCOUNT]: ["INBOX"] },
    });

    await expect(
      action.run({
        id: "message-1,message-2",
        threadIds: "thread-1,thread-2",
        accountEmails: `${ACCOUNT},${ACCOUNT}`,
      }),
    ).rejects.toThrow(
      "Archived 1/2 conversations. Could not archive 1 because Gmail did not accept the change. Refresh Mail and try again.",
    );
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [
        {
          id: "message-1",
          threadId: "thread-1",
          accountEmail: ACCOUNT,
        },
      ],
      { remove: ["INBOX"] },
    );
    expect(mocks.invalidateThreadCache).toHaveBeenCalledTimes(1);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("returns deferred targets after syncing completed archive targets", async () => {
    mocks.gmailBatchArchiveByAccount.mockResolvedValueOnce({
      succeeded: ["message-1"],
      failed: [],
      remaining: ["message-2"],
      retryAfterSeconds: 3,
      threadIdsByTarget: {
        "message-1": "thread-1",
        "message-2": "thread-2",
      },
      removeLabelIdsByAccount: { [ACCOUNT]: ["INBOX"] },
    });

    await expect(
      action.run({
        id: "message-1,message-2",
        threadIds: "thread-1,thread-2",
        accountEmails: `${ACCOUNT},${ACCOUNT}`,
      }),
    ).resolves.toEqual({
      requested: ["message-1", "message-2"],
      succeeded: ["message-1"],
      failed: [],
      remaining: ["message-2"],
      retryAfterSeconds: 3,
    });
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [
        {
          id: "message-1",
          threadId: "thread-1",
          accountEmail: ACCOUNT,
        },
      ],
      { remove: ["INBOX"] },
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });
});
