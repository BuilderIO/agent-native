import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  untrashEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/email-state.js", () => ({
  untrashEmail: mocks.untrashEmail,
}));

import action, { type UntrashEmailActionResult } from "./untrash-email";

const OWNER = "owner@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.untrashEmail.mockImplementation(async ({ id }) => ({
    id,
    threadId: `thread-${id}`,
    isTrashed: false,
  }));
});

describe("untrash-email action", () => {
  it("runs bulk restores concurrently and reports exact partial results", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `email-${index}`);
    const accounts = ids.map((_, index) => `account-${index}@example.com`);
    let active = 0;
    let maxActive = 0;
    mocks.untrashEmail.mockImplementation(async ({ id, accountEmail }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (id === "email-3") throw new Error("provider unavailable");
      return { id, threadId: `thread-${id}`, accountEmail, isTrashed: false };
    });

    const result = (await action.run({
      id: ids.join(","),
      accountEmails: accounts.join(","),
    })) as UntrashEmailActionResult;

    expect(result).toEqual({
      status: "partial",
      requested: ids,
      succeeded: ids.filter((id) => id !== "email-3"),
      failed: [{ id: "email-3", error: "provider unavailable" }],
      message: "Restored 7 of 8 email(s) to Inbox; 1 failed.",
    });
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(5);
    expect(
      mocks.untrashEmail.mock.calls.map(([args]) => [
        args.id,
        args.accountEmail,
      ]),
    ).toEqual(ids.map((id, index) => [id, accounts[index]]));
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("rejects incomplete per-id account routing before mutating anything", async () => {
    await expect(
      action.run({
        id: "email-1,email-2",
        accountEmails: "one@example.com",
      }),
    ).rejects.toThrow("accountEmails must contain one account email per id");
    expect(mocks.untrashEmail).not.toHaveBeenCalled();
  });
});
