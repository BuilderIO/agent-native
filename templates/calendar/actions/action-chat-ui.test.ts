import { describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(({ to }: { to: string }) => to),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

import {
  calendarTimeChoiceChange,
  resolveCalendarActionLocale,
} from "./action-chat-ui.js";

describe("calendar action chat UI", () => {
  it("formats time-choice details using the request locale", async () => {
    getUserSettingMock.mockResolvedValue(null);
    const locale = await resolveCalendarActionLocale(
      "owner@example.test",
      new Headers({ "accept-language": "fr-FR" }),
    );
    const result = calendarTimeChoiceChange(
      "2026-04-23T17:30:00.000Z",
      "2026-04-23T18:15:00.000Z",
      "America/Los_Angeles",
      locale,
    );

    expect(locale).toBe("fr-FR");
    expect(result?.change.detail).toContain("10:30");
    expect(result?.change.detail).not.toMatch(
      /Thu|Apr|AM|America\/Los_Angeles/u,
    );
  });
});
