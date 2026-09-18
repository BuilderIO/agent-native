import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  resetInboxSync: vi.fn(),
  ensureInboxFresh: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/inbox-sync.js", () => ({
  resetInboxSync: mocks.resetInboxSync,
  ensureInboxFresh: mocks.ensureInboxFresh,
}));

import action from "./resync-inbox";

const OWNER = "owner@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.resetInboxSync.mockResolvedValue(undefined);
  mocks.ensureInboxFresh.mockResolvedValue([
    { accountEmail: OWNER, state: "ready", lastSyncedAt: Date.now() },
  ]);
});

describe("resync-inbox action", () => {
  it("resets and force-resyncs every connected account by default", async () => {
    const result = await action.run({} as any, undefined as any);

    expect(mocks.resetInboxSync).toHaveBeenCalledWith(OWNER, undefined);
    expect(mocks.ensureInboxFresh).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ accountEmails: undefined, maxAgeMs: 0 }),
    );
    expect(result.accounts).toHaveLength(1);
  });

  it("scopes to one account when accountEmail is given", async () => {
    await action.run(
      { accountEmail: "a@example.com" } as any,
      undefined as any,
    );

    expect(mocks.resetInboxSync).toHaveBeenCalledWith(OWNER, "a@example.com");
    expect(mocks.ensureInboxFresh).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ accountEmails: ["a@example.com"] }),
    );
  });
});
