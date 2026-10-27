import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fail: vi.fn((message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  }),
  getDecisionsStatus: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  saveCalendarSettings: vi.fn(async (_email: string, patch: unknown) => patch),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: mocks.fail,
}));
vi.mock("@agent-native/core/decisions", () => ({
  getDecisionsStatus: mocks.getDecisionsStatus,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/calendar-settings.js", () => ({
  saveCalendarSettings: mocks.saveCalendarSettings,
}));

import action from "./update-settings.js";

const readyJev = {
  providers: [
    { provider: "jev", status: "ready" },
    { provider: "openai", status: "not_configured" },
  ],
};

describe("update-settings decision provider gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDecisionsStatus.mockResolvedValue(readyJev);
  });

  it("rejects non-empty invitation rules when no provider is connected", async () => {
    mocks.getDecisionsStatus.mockResolvedValue({
      providers: [
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "not_configured" },
      ],
    });

    await expect(
      action.run({ eventRules: { accept: "Accept one-on-ones" } }, {
        caller: "frontend",
      } as never),
    ).rejects.toMatchObject({
      errorCode: "jev_not_enabled",
      statusCode: 403,
    });
    expect(mocks.getDecisionsStatus).toHaveBeenCalledWith("owner@example.com");
    expect(mocks.saveCalendarSettings).not.toHaveBeenCalled();
  });

  it("allows OpenAI-only users to save invitation rules", async () => {
    mocks.getDecisionsStatus.mockResolvedValue({
      providers: [
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ],
    });
    const patch = { eventRules: { accept: "Accept one-on-ones" } };

    await expect(
      action.run(patch, { caller: "frontend" } as never),
    ).resolves.toEqual(patch);
    expect(mocks.saveCalendarSettings).toHaveBeenCalledWith(
      "owner@example.com",
      patch,
    );
  });

  it("allows clearing rules without a configured provider", async () => {
    const patch = { eventRules: { accept: "", decline: "", hide: "" } };

    await expect(
      action.run(patch, { caller: "frontend" } as never),
    ).resolves.toEqual(patch);

    expect(mocks.getDecisionsStatus).not.toHaveBeenCalled();
    expect(mocks.saveCalendarSettings).toHaveBeenCalledWith(
      "owner@example.com",
      patch,
    );
  });
});
