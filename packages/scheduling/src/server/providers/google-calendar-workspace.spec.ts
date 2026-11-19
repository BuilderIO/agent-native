import { describe, expect, it, vi } from "vitest";

import { BookingLifecycleError } from "../booking-service.js";
import {
  calendarRefFor,
  createWorkspaceCalendarProvider,
} from "./google-calendar-workspace.js";

const BOOKING = {
  title: "Intro call",
  description: "A short call",
  startTime: "2030-01-07T17:00:00.000Z",
  endTime: "2030-01-07T17:30:00.000Z",
  timezone: "America/Los_Angeles",
  attendees: [{ email: "guest@example.com", name: "Guest" }],
  iCalUid: "ical-1",
  iCalSequence: 0,
} as never;

function providerWith(dispatch: ReturnType<typeof vi.fn>) {
  return createWorkspaceCalendarProvider({ dispatch: dispatch as never });
}

describe("a calendar provider over the owner-bound bridge", () => {
  it("checks busy time only for the requested calendars", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: {
        calendars: {
          primary: {
            busy: [
              {
                start: "2030-01-07T17:00:00.000Z",
                end: "2030-01-07T17:30:00.000Z",
              },
            ],
          },
        },
      },
    }));
    const busy = await providerWith(dispatch).getBusy({
      credentialId: "workspace:conn-1",
      calendarExternalIds: ["primary"],
      start: new Date("2030-01-07T00:00:00.000Z"),
      end: new Date("2030-01-08T00:00:00.000Z"),
    });
    expect(dispatch).toHaveBeenCalledWith("conn-1", {
      method: "POST",
      path: "/freeBusy",
      body: {
        timeMin: "2030-01-07T00:00:00.000Z",
        timeMax: "2030-01-08T00:00:00.000Z",
        items: [{ id: "primary" }],
      },
    });
    expect(busy).toEqual([
      {
        start: "2030-01-07T17:00:00.000Z",
        end: "2030-01-07T17:30:00.000Z",
        source: "google_calendar:primary",
      },
    ]);
  });

  it("treats an unreadable calendar as unreadable, not as free", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
    }));
    await expect(
      providerWith(dispatch).getBusy({
        credentialId: "workspace:conn-1",
        calendarExternalIds: ["primary"],
        start: new Date("2030-01-07T00:00:00.000Z"),
        end: new Date("2030-01-08T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(BookingLifecycleError);
  });

  it("persists the reference a cancel needs, calendar and event together", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: { id: "evt-9", iCalUID: "uid-9" },
    }));
    const created = await providerWith(dispatch).createEvent({
      credentialId: "workspace:conn-1",
      calendarExternalId: "team@example.com",
      booking: BOOKING,
    });
    // The stored reference names the calendar too, so a cancel can address the event.
    expect(created).toEqual({
      externalId: "team@example.com/evt-9",
      icalUid: "uid-9",
    });
    const ref = created.externalId;

    await providerWith(dispatch).deleteEvent({
      credentialId: "workspace:conn-1",
      externalId: ref,
    });
    expect(dispatch).toHaveBeenLastCalledWith("conn-1", {
      method: "DELETE",
      path: `/calendars/${encodeURIComponent("team@example.com")}/events/evt-9`,
    });
  });

  it("passes the host's reminder choice, including turning reminders off", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: { id: "evt-1" },
    }));
    await providerWith(dispatch).createEvent({
      credentialId: "workspace:conn-1",
      calendarExternalId: "primary",
      booking: BOOKING,
      reminderOverride: [10, 60],
    });
    const body = dispatch.mock.calls[0]![1].body as { reminders: unknown };
    expect(body.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "popup", minutes: 60 },
      ],
    });

    dispatch.mockClear();
    await providerWith(dispatch).createEvent({
      credentialId: "workspace:conn-1",
      calendarExternalId: "primary",
      booking: BOOKING,
      reminderOverride: null,
    });
    expect(
      (dispatch.mock.calls[0]![1].body as { reminders: unknown }).reminders,
    ).toEqual({
      useDefault: false,
    });

    dispatch.mockClear();
    await providerWith(dispatch).createEvent({
      credentialId: "workspace:conn-1",
      calendarExternalId: "primary",
      booking: BOOKING,
    });
    expect(dispatch.mock.calls[0]![1].body).not.toHaveProperty("reminders");
  });

  it("updates the event the booking already has instead of creating a second one", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: { sequence: 2 },
    }));
    const result = await providerWith(dispatch).updateEvent({
      credentialId: "workspace:conn-1",
      externalId: "primary/evt-3",
      booking: { ...BOOKING, startTime: "2030-01-08T17:00:00.000Z" } as never,
    });
    expect(dispatch).toHaveBeenCalledWith("conn-1", {
      method: "PATCH",
      path: `/calendars/primary/events/evt-3`,
      body: expect.objectContaining({
        start: {
          dateTime: "2030-01-08T17:00:00.000Z",
          timeZone: "America/Los_Angeles",
        },
      }),
    });
    expect(result).toEqual({ iCalSequence: 2 });
  });

  it("refuses a legacy id, an empty connection and a revoked bridge with the same typed code", async () => {
    const cases = [
      { ref: "legacy-row", status: 200 },
      { ref: "workspace:   ", status: 200 },
      { ref: "workspace:conn-1", status: 403 },
    ];
    for (const testCase of cases) {
      const dispatch = vi.fn(async () => ({
        status: testCase.status,
        body: {},
      }));
      const provider = providerWith(dispatch);
      await expect(
        provider.getBusy({
          credentialId: testCase.ref,
          calendarExternalIds: ["primary"],
          start: new Date("2030-01-07T00:00:00.000Z"),
          end: new Date("2030-01-08T00:00:00.000Z"),
        }),
      ).rejects.toMatchObject({ errorCode: "calendar_credential_unavailable" });
    }
  });

  it("lists calendars from the connection, skipping entries without an id", async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      body: {
        items: [
          { id: "primary", summary: "Owner", primary: true },
          { summary: "no id" },
        ],
      },
    }));
    expect(
      await providerWith(dispatch).listCalendars({
        credentialId: "workspace:conn-1",
      }),
    ).toEqual([{ externalId: "primary", name: "Owner", primary: true }]);
  });

  it("answers a connect attempt by naming where calendars are connected", async () => {
    const provider = providerWith(vi.fn());
    await expect(
      provider.startOAuth({
        redirectUri: "https://example.test/cb",
        state: "s",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
