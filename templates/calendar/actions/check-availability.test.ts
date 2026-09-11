import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const readSettingMock = vi.hoisted(() => vi.fn());
const listCalendarEventsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  readSetting: readSettingMock,
}));

vi.mock("./list-events.js", () => ({
  listCalendarEvents: listCalendarEventsMock,
}));

import action from "./check-availability";

const OWNER = "owner@example.com";

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Record<string, unknown>
  >;
}

describe("check-availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue(OWNER);
    getRequestTimezoneMock.mockReturnValue("UTC");
    getUserSettingMock.mockResolvedValue(null);
    readSettingMock.mockResolvedValue(null);
  });

  it("fails closed instead of offering slots when a source could not be read", async () => {
    listCalendarEventsMock.mockResolvedValue({
      events: [],
      errors: [{ email: "secondary@example.com", error: "token expired" }],
    });

    // 2026-09-08 is a Tuesday, inside the default 09:00-17:00 schedule.
    const result = await run({ date: "2026-09-08", duration: 30 });

    expect(result.actionable).toBe(false);
    expect(result.slots).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.errors).toEqual([
      { email: "secondary@example.com", error: "token expired" },
    ]);
  });

  it("blocks a slot covered by a secondary connected account's event", async () => {
    listCalendarEventsMock.mockResolvedValue({
      events: [
        {
          id: "evt-1",
          title: "Secondary busy",
          start: "2026-09-08T10:00:00.000Z",
          end: "2026-09-08T10:30:00.000Z",
          allDay: false,
          source: "google",
          // Booked on a connected secondary Google account, not the owner's
          // primary — availability is still for the signed-in owner.
          accountEmail: "secondary@example.com",
        },
      ],
      errors: [],
    });

    const result = await run({ date: "2026-09-08", duration: 30 });

    expect(result.actionable).toBe(true);
    expect(
      result.slots as Array<{ start: string; end: string }>,
    ).not.toContainEqual(expect.objectContaining({ start: "10:00 AM" }));
  });
});
