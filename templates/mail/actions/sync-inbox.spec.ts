import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  syncInbox: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/inbox-sync.js", () => ({
  syncInbox: mocks.syncInbox,
}));

import action from "./sync-inbox.js";

const OWNER = "owner@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.syncInbox.mockResolvedValue({
    accounts: [
      {
        accountEmail: OWNER,
        state: "initial",
        lastSyncedAt: null,
        changed: true,
        pushGeneration: 2,
        lastPushGeneration: 1,
        pushPending: true,
      },
    ],
  });
});

describe("sync-inbox action", () => {
  it("advances all connected accounts when accountEmails is omitted", async () => {
    const result = await action.run({} as any, undefined as any);

    expect(mocks.syncInbox).toHaveBeenCalledWith(OWNER, {
      accountEmails: undefined,
    });
    expect(result.accounts[0]).toMatchObject({
      state: "initial",
      changed: true,
      pushGeneration: 2,
      lastPushGeneration: 1,
      pushPending: true,
    });
  });

  it("passes only the explicitly selected accounts to the bounded sync helper", async () => {
    const accountEmails = ["selected@example.com"];

    await action.run({ accountEmails } as any, undefined as any);

    expect(mocks.syncInbox).toHaveBeenCalledWith(OWNER, { accountEmails });
  });

  it("requires an authenticated caller", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);

    await expect(action.run({} as any, undefined as any)).rejects.toThrow(
      "no authenticated user",
    );
    expect(mocks.syncInbox).not.toHaveBeenCalled();
  });
});
