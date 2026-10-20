import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const readSettingMock = vi.hoisted(() => vi.fn());
const listCalendarEventsMock = vi.hoisted(() => vi.fn());
const buildDeepLinkMock = vi.hoisted(() =>
  vi.fn(({ to }: { to: string }) => `calendar:${to}`),
);

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: buildDeepLinkMock,
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

  it("projects only a valid best slot into the shared action card", () => {
    const result = {
      change: {
        verb: "created",
        kind: "calendar-time-choice",
        title: "Best shared time",
        detail: "Thu, Apr 23 · 10:30 AM–11:15 AM · PT",
        url: "calendar:/home?createSlot=1&start=2026-04-23T17%3A30%3A00.000Z&end=2026-04-23T18%3A15%3A00.000Z&timezone=America%2FLos_Angeles",
      },
    };
    const chatUI = action.chatUI!;

    expect(chatUI.when?.({}, result)).toBe(true);
    expect(chatUI.projectResult?.({}, result)).toMatchObject({
      change: {
        verb: "created",
        kind: "calendar-time-choice",
        title: "Best shared time",
        detail: "Thu, Apr 23 · 10:30 AM–11:15 AM · PT",
        url: "calendar:/home?createSlot=1&start=2026-04-23T17%3A30%3A00.000Z&end=2026-04-23T18%3A15%3A00.000Z&timezone=America%2FLos_Angeles",
      },
    });

    const unavailable = { actionable: false, errors: [{ source: "google" }] };
    expect(chatUI.when?.({}, unavailable)).toBe(false);
    expect(chatUI.projectResult?.({}, unavailable)).toBeNull();
  });
});
