import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  isConnected: vi.fn(),
  gmailBatchModifyByAccount: vi.fn(),
  toggleStar: vi.fn(),
  resolveMutationAccounts: vi.fn(),
  syncInboxLabelDeltaForTargets: vi.fn(),
  invalidateThreadCache: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/email-state.js", () => ({
  resolveMutationAccounts: mocks.resolveMutationAccounts,
  toggleStar: mocks.toggleStar,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  gmailBatchModifyByAccount: mocks.gmailBatchModifyByAccount,
  isConnected: mocks.isConnected,
}));

vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDeltaForTargets: mocks.syncInboxLabelDeltaForTargets,
}));

vi.mock("../server/lib/thread-cache.js", () => ({
  invalidateThreadCache: mocks.invalidateThreadCache,
}));

import action from "./star-email";

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
  mocks.gmailBatchModifyByAccount.mockResolvedValue({
    succeeded: ["message-1"],
    failed: [],
    remaining: ["message-2"],
    retryAfterSeconds: 3,
  });
});

describe("star-email action", () => {
  it("returns quota-deferred targets for the queue to retry in one batch", async () => {
    const result = await action.run({
      id: "message-1,message-2",
      threadIds: "thread-1,thread-2",
      accountEmails: `${ACCOUNT},${ACCOUNT}`,
    });

    expect(result).toEqual({
      requested: ["message-1", "message-2"],
      succeeded: ["message-1"],
      failed: [],
      remaining: ["message-2"],
      retryAfterSeconds: 3,
    });
    expect(mocks.gmailBatchModifyByAccount).toHaveBeenCalledWith(
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
      ["STARRED"],
      undefined,
    );
    expect(mocks.syncInboxLabelDeltaForTargets).toHaveBeenCalledWith(
      OWNER,
      [{ id: "message-1", threadId: "thread-1", accountEmail: ACCOUNT }],
      { add: ["STARRED"], remove: undefined, scope: "message" },
    );
  });
});
