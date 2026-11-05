import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => undefined,
  getRequestUserEmail: () => "test@example.com",
}));
vi.mock("../server/lib/google-calendar.js", () => ({
  getAuthStatus: vi.fn(),
}));

import { normalizeCreateEventInput } from "./event-action-helpers";

describe("saved Calendar timezone", () => {
  it("interprets zoneless event times in the saved timezone", () => {
    const event = {
      title: "Meeting",
      start: "2026-11-04T10:00:00",
      end: "2026-11-04T11:00:00",
      defaultTimezone: "Asia/Kolkata",
    };
    expect(normalizeCreateEventInput(event, "Asia/Kolkata")).toMatchObject({
      start: "2026-11-04T04:30:00.000Z",
      end: "2026-11-04T05:30:00.000Z",
      startTimeZone: "Asia/Kolkata",
      endTimeZone: "Asia/Kolkata",
    });
  });
});
