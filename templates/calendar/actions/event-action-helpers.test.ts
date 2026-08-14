import { describe, expect, it, vi } from "vitest";

const getAuthStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => undefined,
  getRequestUserEmail: () => "test@example.com",
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  getAuthStatus: getAuthStatusMock,
}));

import {
  buildStatusEventFields,
  ensureOrganizerInAttendees,
  normalizeCreateEventInput,
  validateStatusEventTiming,
  resolveOwnedAccountEmail,
} from "./event-action-helpers";

describe("resolveOwnedAccountEmail", () => {
  it("accepts a connected secondary account beneath the signed-in owner", async () => {
    getAuthStatusMock.mockResolvedValue({
      accounts: [
        { email: "owner@example.com" },
        { email: "secondary@example.com" },
      ],
    });

    await expect(
      resolveOwnedAccountEmail("secondary@example.com", "owner@example.com"),
    ).resolves.toBe("secondary@example.com");
  });

  it("rejects missing or ambiguous account choices", async () => {
    getAuthStatusMock.mockResolvedValue({
      accounts: [
        { email: "owner@example.com" },
        { email: "secondary@example.com" },
      ],
    });

    await expect(
      resolveOwnedAccountEmail(undefined, "owner@example.com"),
    ).rejects.toThrow("Multiple Google Calendar accounts are connected");
    await expect(
      resolveOwnedAccountEmail("missing@example.com", "owner@example.com"),
    ).rejects.toThrow("Account not owned by current user");
  });
});

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
        autoDeclineMode: "declineAllConflictingInvitations",
        declineMessage: "Declined because I am out of office",
      },
    });
  });

  it("preserves explicit out-of-office decline settings", () => {
    expect(
      buildStatusEventFields({
        eventType: "outOfOffice",
        autoDeclineMode: "declineOnlyNewConflictingInvitations",
        declineMessage: "I will reply when I return.",
      }),
    ).toMatchObject({
      outOfOfficeProperties: {
        autoDeclineMode: "declineOnlyNewConflictingInvitations",
        declineMessage: "I will reply when I return.",
      },
    });
  });

  it("omits a decline message when invitations will not be declined", () => {
    expect(
      buildStatusEventFields({
        eventType: "outOfOffice",
        autoDeclineMode: "declineNone",
        declineMessage: "This should not be sent.",
      }),
    ).toMatchObject({
      outOfOfficeProperties: {
        autoDeclineMode: "declineNone",
        declineMessage: undefined,
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

  it("creates unlabeled office working-location fields without a placeholder name", () => {
    expect(
      buildStatusEventFields({
        eventType: "workingLocation",
        workingLocationType: "officeLocation",
      }),
    ).toMatchObject({
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {},
      },
    });
  });
});

describe("normalizeCreateEventInput", () => {
  it("defaults the OOO title and translates one inclusive date into timed bounds", () => {
    expect(
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-07-31",
        end: "2026-07-31",
        startTimeZone: "America/Indiana/Indianapolis",
        fullDay: true,
      }),
    ).toEqual({
      title: "Out of office",
      start: "2026-07-31T04:00:00.000Z",
      end: "2026-08-01T04:00:00.000Z",
      startTimeZone: "America/Indiana/Indianapolis",
      endTimeZone: "America/Indiana/Indianapolis",
      allDay: false,
    });
  });

  it("uses the inclusive end date and preserves local midnight across DST", () => {
    expect(
      normalizeCreateEventInput({
        title: "Winter break",
        eventType: "outOfOffice",
        start: "2026-10-31",
        end: "2026-11-01",
        startTimeZone: "America/New_York",
        fullDay: true,
      }),
    ).toMatchObject({
      title: "Winter break",
      start: "2026-10-31T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
      allDay: false,
    });
  });

  it("normalizes full-day OOO across a skipped local midnight", () => {
    expect(
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-09-06",
        end: "2026-09-06",
        startTimeZone: "America/Santiago",
        fullDay: true,
      }),
    ).toMatchObject({
      start: "2026-09-06T04:00:00.000Z",
      end: "2026-09-07T03:00:00.000Z",
      allDay: false,
    });
  });

  it("requires dates in order and an explicit timezone for full-day OOO", () => {
    expect(() =>
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-08-02",
        end: "2026-08-01",
        startTimeZone: "America/New_York",
        fullDay: true,
      }),
    ).toThrow("end date must be on or after");
    expect(() =>
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-08-01",
        end: "2026-08-01",
        fullDay: true,
      }),
    ).toThrow("require an IANA timezone");
    expect(() =>
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-02-30",
        end: "2026-02-30",
        startTimeZone: "America/New_York",
        fullDay: true,
      }),
    ).toThrow("valid YYYY-MM-DD dates");
  });

  it("rejects timed values masquerading as full-day semantics", () => {
    expect(() =>
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2026-08-01T09:00:00-04:00",
        end: "2026-08-01T17:00:00-04:00",
        startTimeZone: "America/New_York",
        fullDay: true,
      }),
    ).toThrow("require valid YYYY-MM-DD dates");
  });

  it("rejects fullDay for non-OOO events", () => {
    expect(() =>
      normalizeCreateEventInput({
        title: "Ordinary event",
        eventType: "default",
        start: "2026-08-01T09:00:00-04:00",
        end: "2026-08-01T17:00:00-04:00",
        fullDay: true,
      }),
    ).toThrow("only supported for out-of-office events");
  });

  it("rejects a civil date skipped entirely by its timezone", () => {
    expect(() =>
      normalizeCreateEventInput({
        eventType: "outOfOffice",
        start: "2011-12-30",
        end: "2011-12-30",
        startTimeZone: "Pacific/Apia",
        fullDay: true,
      }),
    ).toThrow("at least one valid local instant");
  });

  it("continues to require a title for ordinary events", () => {
    expect(() =>
      normalizeCreateEventInput({
        eventType: "default",
        start: "2026-08-01T13:00:00.000Z",
        end: "2026-08-01T14:00:00.000Z",
      }),
    ).toThrow("Event title is required");
  });

  it("allows titleless all-day working locations with exclusive date bounds", () => {
    expect(
      normalizeCreateEventInput({
        eventType: "workingLocation",
        start: "2026-08-10",
        end: "2026-08-15",
        allDay: true,
      }),
    ).toEqual({
      title: "",
      start: "2026-08-10",
      end: "2026-08-15",
      startTimeZone: undefined,
      endTimeZone: undefined,
      allDay: true,
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

  it("allows multi-day all-day working locations", () => {
    expect(() =>
      validateStatusEventTiming({
        eventType: "workingLocation",
        allDay: true,
        start: "2026-07-06",
        end: "2026-07-11",
      }),
    ).not.toThrow();
  });

  it("rejects empty all-day working-location ranges", () => {
    expect(() =>
      validateStatusEventTiming({
        eventType: "workingLocation",
        allDay: true,
        start: "2026-07-06",
        end: "2026-07-06",
      }),
    ).toThrow("end date must be after");
  });
});
