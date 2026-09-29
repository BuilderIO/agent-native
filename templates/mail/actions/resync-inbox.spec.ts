import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  resetInboxSync: vi.fn(),
  syncInbox: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/inbox-sync.js", () => ({
  resetInboxSync: mocks.resetInboxSync,
  syncInbox: mocks.syncInbox,
}));

import action from "./resync-inbox";

const OWNER = "owner@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.resetInboxSync.mockResolvedValue(undefined);
  mocks.syncInbox.mockResolvedValue({
    accounts: [
      { accountEmail: OWNER, state: "ready", lastSyncedAt: Date.now() },
    ],
  });
});

describe("resync-inbox action", () => {
  it("resets and advances every connected account by one bounded step", async () => {
    const result = await action.run({} as any, undefined as any);

    expect(mocks.resetInboxSync).toHaveBeenCalledWith(OWNER, undefined);
    expect(mocks.syncInbox).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ accountEmails: undefined }),
    );
    expect(result.accounts).toHaveLength(1);
  });

  it("scopes to one account when accountEmail is given", async () => {
    await action.run(
      { accountEmail: "a@example.com" } as any,
      undefined as any,
    );

    expect(mocks.resetInboxSync).toHaveBeenCalledWith(OWNER, "a@example.com");
    expect(mocks.syncInbox).toHaveBeenCalledWith(OWNER, {
      accountEmails: ["a@example.com"],
    });
  });
});
