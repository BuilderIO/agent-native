import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppProductionUrl: vi.fn(() => "https://clips.example"),
  getQuery: vi.fn(),
  mutateUserSetting: vi.fn(),
  readToken: vi.fn(),
  setResponseHeaders: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => mocks.getAppProductionUrl(),
  withConfiguredAppBasePath: (value: string) => value,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mocks.getQuery(...args),
  setResponseHeaders: (...args: unknown[]) => mocks.setResponseHeaders(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("@agent-native/core/settings", () => ({
  mutateUserSetting: (...args: unknown[]) => mocks.mutateUserSetting(...args),
}));

vi.mock("../../lib/notification-preferences.js", () => ({
  readClipsNotificationOptOutToken: (...args: unknown[]) =>
    mocks.readToken(...args),
}));

import handler from "./clip-views.get.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getQuery.mockReturnValue({ token: "token" });
  mocks.readToken.mockReturnValue({
    email: "owner@example.com",
    category: "views",
    expiresAt: Date.now() + 60_000,
  });
  mocks.mutateUserSetting.mockResolvedValue({});
});

describe("Clip view email opt-out route", () => {
  it("turns off only view notifications for a valid token", async () => {
    const result = await (handler as (event: unknown) => Promise<string>)({});

    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "clips-user-prefs",
      expect.any(Function),
    );
    const updater = mocks.mutateUserSetting.mock.calls[0][2] as (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>;
    expect(updater({ commentNotifications: true })).toEqual({
      commentNotifications: true,
      viewNotifications: false,
    });
    expect(result).toContain("Clip view emails are off");
    expect(result).toContain("See or edit all notification settings");
    expect(result).toContain(
      'href="https://clips.example/settings/notifications"',
    );
  });

  it("does not mutate settings for an invalid or expired token", async () => {
    mocks.readToken.mockReturnValue(null);

    const result = await (handler as (event: unknown) => Promise<string>)({});

    expect(mocks.mutateUserSetting).not.toHaveBeenCalled();
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toContain("Link not valid");
  });
});
