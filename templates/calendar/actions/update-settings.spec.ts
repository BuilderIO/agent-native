import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fail: vi.fn((message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  }),
  getJevContextCredentials: vi.fn(async () => ({ apiKey: "fake-key" })),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  isJevEnabled: vi.fn(async () => true),
  saveCalendarSettings: vi.fn(async (_email: string, patch: unknown) => patch),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: mocks.fail,
}));
vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getRequestUserEmail: mocks.getRequestUserEmail,
  isJevEnabled: mocks.isJevEnabled,
}));
vi.mock("../server/lib/calendar-settings.js", () => ({
  saveCalendarSettings: mocks.saveCalendarSettings,
}));

import action from "./update-settings.js";

describe("update-settings Jev gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJevEnabled.mockResolvedValue(true);
  });

  it("rejects non-empty invitation rules when Jev is not connected", async () => {
    mocks.isJevEnabled.mockResolvedValue(false);

    await expect(
      action.run({ eventRules: { accept: "Accept one-on-ones" } }, {
        caller: "frontend",
      } as never),
    ).rejects.toMatchObject({
      errorCode: "jev_not_enabled",
      statusCode: 403,
    });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.saveCalendarSettings).not.toHaveBeenCalled();
  });

  it("allows clearing rules without Jev", async () => {
    mocks.isJevEnabled.mockResolvedValue(false);
    const patch = { eventRules: { accept: "", decline: "", hide: "" } };

    await expect(
      action.run(patch, { caller: "frontend" } as never),
    ).resolves.toEqual(patch);

    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
    expect(mocks.saveCalendarSettings).toHaveBeenCalledWith(
      "owner@example.com",
      patch,
    );
  });
});
