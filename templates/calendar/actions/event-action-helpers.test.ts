import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "test@example.com",
}));

vi.mock("../server/lib/google-calendar.js", () => ({}));

import {
  buildStatusEventFields,
  ensureOrganizerInAttendees,
  validateStatusEventTiming,
} from "./event-action-helpers";

describe("ensureOrganizerInAttendees", () => {
  it("leaves empty or solo events unchanged", () => {
    expect(ensureOrganizerInAttendees(undefined, "host@example.com")).toBe(
      undefined,
    );
    expect(ensureOrganizerInAttendees([], "host@example.com")).toEqual([]);
  });

  it("prepends the organizer when guests are invited without them", () => {
    expect(
      ensureOrganizerInAttendees(
        [{ email: "guest@example.com" }],
        "host@example.com",
      ),
    ).toEqual([
      {
        email: "host@example.com",
        organizer: true,
        self: true,
        responseStatus: "accepted",
      },
      { email: "guest@example.com" },
    ]);
  });

  it("marks an existing organizer entry as self/accepted", () => {
    expect(
      ensureOrganizerInAttendees(
        [
          { email: "HOST@example.com", displayName: "Host" },
          { email: "guest@example.com" },
        ],
        "host@example.com",
      ),
    ).toEqual([
      {
        email: "HOST@example.com",
        displayName: "Host",
        organizer: true,
        self: true,
        responseStatus: "accepted",
      },
      { email: "guest@example.com" },
    ]);
  });
});
describe("buildStatusEventFields", () => {
  it("creates native out-of-office fields", () => {
    expect(buildStatusEventFields({ eventType: "outOfOffice" })).toEqual({
      eventType: "outOfOffice",
      transparency: "opaque",
      outOfOfficeProperties: {
        autoDeclineMode: "declineNone",
      },
    });
  });

  it("creates native focus-time fields", () => {
    expect(buildStatusEventFields({ eventType: "focusTime" })).toEqual({
      eventType: "focusTime",
      transparency: "opaque",
      focusTimeProperties: {
        autoDeclineMode: "declineNone",
        chatStatus: "doNotDisturb",
      },
    });
  });

  it("creates native working-location fields", () => {
    expect(
      buildStatusEventFields({
        eventType: "workingLocation",
        workingLocationType: "homeOffice",
        title: "WFH",
      }),
    ).toEqual({
      eventType: "workingLocation",
      transparency: "transparent",
      visibility: "public",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
    });
  });

  it("creates labeled office working-location fields", () => {
    expect(
      buildStatusEventFields({
        eventType: "workingLocation",
        workingLocationType: "officeLocation",
        workingLocationLabel: "Pier 57",
      }),
    ).toMatchObject({
      transparency: "transparent",
      visibility: "public",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: { label: "Pier 57" },
      },
    });
  });
});

describe("validateStatusEventTiming", () => {
  it("rejects all-day out-of-office and focus-time events", () => {
    const args = {
      allDay: true,
      start: "2026-07-06",
      end: "2026-07-07",
    };

    expect(() =>
      validateStatusEventTiming({ ...args, eventType: "outOfOffice" }),
    ).toThrow("Out of office and focus time events must be timed.");
    expect(() =>
      validateStatusEventTiming({ ...args, eventType: "focusTime" }),
    ).toThrow("Out of office and focus time events must be timed.");
  });

  it("allows single-day all-day working locations", () => {
    expect(() =>
      validateStatusEventTiming({
        eventType: "workingLocation",
        allDay: true,
        start: "2026-07-06",
        end: "2026-07-07",
      }),
    ).not.toThrow();
  });

  it("allows single-day all-day working locations from ISO datetimes", () => {
    expect(() =>
      validateStatusEventTiming({
        eventType: "workingLocation",
        allDay: true,
        start: "2026-07-06T04:00:00.000Z",
        end: "2026-07-07T04:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("rejects multi-day all-day working locations", () => {
    expect(() =>
      validateStatusEventTiming({
        eventType: "workingLocation",
        allDay: true,
        start: "2026-07-06",
        end: "2026-07-11",
      }),
    ).toThrow("All-day working location events must be a single day.");
  });
});
