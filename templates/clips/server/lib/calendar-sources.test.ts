import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCalendarList: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("./google-calendar-client.js", () => ({
  listCalendarList: mocks.listCalendarList,
  listEvents: mocks.listEvents,
}));

import {
  calendarChoices,
  enabledCalendarIds,
  listEnabledCalendarEvents,
} from "./calendar-sources";
import type { CalendarEvent } from "./google-calendar-client";

const TEAM = "team@group.calendar.google.com";
const HOLIDAYS = "en.usa#holiday@group.v.calendar.google.com";

function event(
  id: string,
  start: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id,
    start: { dateTime: start },
    end: { dateTime: start },
    ...extra,
  };
}

function readArgs() {
  return {
    accessToken: "token",
    timeMin: "2026-11-16T00:00:00.000Z",
    timeMax: "2026-12-16T00:00:00.000Z",
    maxResults: 250,
  };
}

describe("enabled calendars", () => {
  it("reads only the main calendar until another is turned on", () => {
    expect(enabledCalendarIds({ enabledCalendarIdsJson: null })).toEqual([
      "primary",
    ]);
    expect(enabledCalendarIds({})).toEqual(["primary"]);
    expect(enabledCalendarIds({ enabledCalendarIdsJson: "not json" })).toEqual([
      "primary",
    ]);
  });

  it("puts the main calendar first and keeps each calendar once", () => {
    expect(
      enabledCalendarIds({
        enabledCalendarIdsJson: JSON.stringify([TEAM, "primary", TEAM, 7, ""]),
      }),
    ).toEqual(["primary", TEAM]);
  });

  it("reads nothing when every calendar is off", () => {
    expect(enabledCalendarIds({ enabledCalendarIdsJson: "[]" })).toEqual([]);
  });
});

describe("calendar choices", () => {
  it("lists the readable calendars, main first, with their switch state", () => {
    const choices = calendarChoices(
      [
        { id: TEAM, summary: "Team", accessRole: "reader" },
        {
          id: "me@example.com",
          summary: "me@example.com",
          backgroundColor: "#9fe1e7",
          accessRole: "owner",
          primary: true,
        },
        {
          id: "busy@example.com",
          summary: "Busy",
          accessRole: "freeBusyReader",
        },
        {
          id: HOLIDAYS,
          summary: "Holidays",
          summaryOverride: "US holidays",
          accessRole: "reader",
        },
      ],
      { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    );

    expect(choices).toEqual([
      {
        id: "primary",
        name: "me@example.com",
        color: "#9fe1e7",
        primary: true,
        enabled: true,
      },
      { id: TEAM, name: "Team", color: null, primary: false, enabled: true },
      {
        id: HOLIDAYS,
        name: "US holidays",
        color: null,
        primary: false,
        enabled: false,
      },
    ]);
  });
});

describe("reading every enabled calendar", () => {
  beforeEach(() => {
    mocks.listEvents.mockReset();
  });

  it("reads each calendar that is on and keeps a shared meeting once", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) =>
      calendarId === "primary"
        ? {
            items: [
              event("standup", "2026-11-17T15:00:00Z", {
                iCalUID: "standup@google.com",
              }),
            ],
          }
        : {
            items: [
              event("standup", "2026-11-17T15:00:00Z", {
                iCalUID: "standup@google.com",
              }),
              event("planning", "2026-11-18T15:00:00Z"),
            ],
          },
    );

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify([TEAM, "primary"]) },
    });

    expect(
      mocks.listEvents.mock.calls.map(([args]) => args.calendarId),
    ).toEqual(["primary", TEAM]);
    expect(
      result.items.map(({ calendarId, event }) => [calendarId, event.id]),
    ).toEqual([
      ["primary", "standup"],
      [TEAM, "planning"],
    ]);
    expect(result).toMatchObject({ capped: false, error: undefined });
  });

  it("keeps every instance of a recurring meeting", async () => {
    mocks.listEvents.mockResolvedValue({
      items: [
        event("weekly_20261117", "2026-11-17T15:00:00Z", { iCalUID: "weekly" }),
        event("weekly_20261124", "2026-11-24T15:00:00Z", { iCalUID: "weekly" }),
      ],
    });

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: {},
    });

    expect(result.items).toHaveLength(2);
  });

  it("drops a cancelled copy while another calendar still has the meeting", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) => ({
      items: [
        event("sync", "2026-11-17T15:00:00Z", {
          status: calendarId === "primary" ? "cancelled" : "confirmed",
        }),
      ],
    }));

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(
      result.items.map(({ calendarId, event }) => [calendarId, event.status]),
    ).toEqual([[TEAM, "confirmed"]]);
  });

  it("keeps a cancellation no other calendar contradicts", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) => ({
      items:
        calendarId === "primary"
          ? [event("sync", "2026-11-17T15:00:00Z", { status: "cancelled" })]
          : [event("planning", "2026-11-18T15:00:00Z")],
    }));

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(
      result.items.map(({ calendarId, event }) => [calendarId, event.status]),
    ).toEqual([
      ["primary", "cancelled"],
      [TEAM, undefined],
    ]);
  });

  it("matches a shared meeting whose calendars give its start in different time zones", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) => ({
      items: [
        calendarId === "primary"
          ? event("standup", "2026-11-17T10:00:00-05:00", {
              iCalUID: "standup@google.com",
            })
          : event("standup-copy", "2026-11-17T15:00:00Z", {
              iCalUID: "standup@google.com",
            }),
      ],
    }));

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(
      result.items.map(({ calendarId, event }) => [calendarId, event.id]),
    ).toEqual([["primary", "standup"]]);
  });

  it("says when a calendar had more events than one read returns", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) => ({
      items: [],
      nextPageToken: calendarId === TEAM ? "page-6" : undefined,
    }));

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(result.capped).toBe(true);
  });

  it("returns the calendars that read when another one fails", async () => {
    const failure = new Error("Google calendar list failed (500): boom");
    mocks.listEvents.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TEAM) throw failure;
      return { items: [event("standup", "2026-11-17T15:00:00Z")] };
    });

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(result.items).toHaveLength(1);
    expect(result.error).toBe(failure);
  });

  it("skips a calendar removed from the account without an error", async () => {
    mocks.listEvents.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TEAM) {
        throw new Error("Google calendar list failed (404): Not Found");
      }
      return { items: [] };
    });

    const result = await listEnabledCalendarEvents({
      ...readArgs(),
      account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
    });

    expect(result.error).toBeUndefined();
  });

  it("throws when every calendar fails, so the account error is recorded", async () => {
    const failure = new Error("Google calendar list failed (401): expired");
    mocks.listEvents.mockRejectedValue(failure);

    await expect(
      listEnabledCalendarEvents({
        ...readArgs(),
        account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
      }),
    ).rejects.toBe(failure);
  });

  it("throws when no calendar read, even if another was removed", async () => {
    const failure = new Error("Google calendar list failed (401): expired");
    mocks.listEvents.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TEAM) {
        throw new Error("Google calendar list failed (404): Not Found");
      }
      throw failure;
    });

    await expect(
      listEnabledCalendarEvents({
        ...readArgs(),
        account: { enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]) },
      }),
    ).rejects.toBe(failure);
  });
});
