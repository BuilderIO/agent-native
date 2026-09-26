import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

import action from "./mark-thread-read";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("mark-thread-read quota cooldown", () => {
  it("lets shared typed cooldown failures reach the action boundary unchanged", async () => {
    const cooldown = Object.assign(
      new Error("Email service is briefly busy."),
      {
        statusCode: 429,
        errorCode: "gmail_quota_cooldown",
        details: { retryAfterSeconds: 300 },
      },
    );
    mocks.markThreadRead.mockRejectedValue(cooldown);

    await expect(action.run({ threadId: "thread-1" })).rejects.toBe(cooldown);
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("keeps unrelated failures as internal errors", async () => {
    mocks.markThreadRead.mockRejectedValue(new Error("database unavailable"));

    await expect(action.run({ threadId: "thread-1" })).rejects.toThrow(
      "database unavailable",
    );
  });
});
