import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());
const getRequestTimezoneMock = vi.hoisted(() => vi.fn());

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: getUserSettingMock,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestTimezone: getRequestTimezoneMock,
}));

import { serverTimezone } from "../jobs/cron.js";
import { resolveUserSchedulingTimezone } from "./user-timezone.js";

describe("resolveUserSchedulingTimezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSettingMock.mockResolvedValue(null);
    getRequestTimezoneMock.mockReturnValue(undefined);
  });

  it("prefers the zone the user pinned over the requesting browser", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "America/New_York" });
    getRequestTimezoneMock.mockReturnValue("Europe/Paris");

    await expect(resolveUserSchedulingTimezone("a@b.test")).resolves.toBe(
      "America/New_York",
    );
  });

  it("falls back to the request zone when nothing is pinned", async () => {
    getRequestTimezoneMock.mockReturnValue("Europe/Paris");

    await expect(resolveUserSchedulingTimezone("a@b.test")).resolves.toBe(
      "Europe/Paris",
    );
  });

  it("ignores an unusable request zone rather than persisting it", async () => {
    getRequestTimezoneMock.mockReturnValue("Not/AZone");

    await expect(resolveUserSchedulingTimezone("a@b.test")).resolves.toBe(
      serverTimezone(),
    );
  });

  it("surfaces a settings read failure instead of guessing a zone", async () => {
    getUserSettingMock.mockRejectedValue(new Error("settings unavailable"));
    getRequestTimezoneMock.mockReturnValue("Europe/Paris");

    await expect(resolveUserSchedulingTimezone("a@b.test")).rejects.toThrow(
      "settings unavailable",
    );
  });
});
