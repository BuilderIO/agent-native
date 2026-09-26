import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  GmailQuotaCooldownError: class extends Error {
    constructor(readonly retryAfterMs: number) {
      super("Gmail quota cooldown active");
      this.name = "GmailQuotaCooldownError";
    }
  },
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  markThreadRead: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/email-state.js", () => ({
  markThreadRead: mocks.markThreadRead,
}));

vi.mock("../server/lib/google-api.js", () => ({
  GmailQuotaCooldownError: mocks.GmailQuotaCooldownError,
}));

import action from "./mark-thread-read";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("mark-thread-read quota cooldown", () => {
  it("returns a typed 429 with a bounded retry delay", async () => {
    mocks.markThreadRead.mockRejectedValue(
      new mocks.GmailQuotaCooldownError(900_000),
    );

    await expect(action.run({ threadId: "thread-1" })).rejects.toMatchObject({
      statusCode: 429,
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 300 },
    });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("keeps unrelated failures as internal errors", async () => {
    mocks.markThreadRead.mockRejectedValue(new Error("database unavailable"));

    await expect(action.run({ threadId: "thread-1" })).rejects.toThrow(
      "database unavailable",
    );
  });
});
