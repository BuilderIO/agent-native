import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  trashEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/email-state.js", () => ({
  trashEmail: mocks.trashEmail,
}));

import action, { type TrashEmailActionResult } from "./trash-email";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.trashEmail.mockImplementation(async ({ id, accountEmail }) => ({
    id,
    threadId: `thread-${id}`,
    accountEmail,
    isTrashed: true,
  }));
});

describe("trash-email action", () => {
  it("keeps the single-message response backward compatible", async () => {
    const result = await action.run({ id: "email-1", accountEmail: ACCOUNT });

    expect(result).toBe("Trashed 1 email(s) successfully");
    expect(mocks.trashEmail).toHaveBeenCalledWith({
      id: "email-1",
      ownerEmail: OWNER,
      accountEmail: ACCOUNT,
    });
  });

  it("returns per-id results for a partial bulk mutation", async () => {
    mocks.trashEmail.mockImplementation(async ({ id }) => {
      if (id === "email-2") throw new Error("provider unavailable");
      return { id, threadId: `thread-${id}`, isTrashed: true };
    });

    const result = (await action.run({
      id: "email-1,email-2",
      accountEmails: `${ACCOUNT},other@example.com`,
    })) as TrashEmailActionResult;

    expect(result).toEqual({
      requested: ["email-1", "email-2"],
      succeeded: ["email-1"],
      failed: [{ id: "email-2", error: "provider unavailable" }],
    });
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });
});
