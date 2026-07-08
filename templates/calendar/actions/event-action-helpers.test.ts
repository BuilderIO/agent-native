import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "test@example.com",
}));

vi.mock("../server/lib/google-calendar.js", () => ({}));

import {
  buildStatusEventFields,
  ensureOrganizerInAttendees,
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
});
