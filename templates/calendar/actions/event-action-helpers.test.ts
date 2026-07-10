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
