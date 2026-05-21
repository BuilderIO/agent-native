import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "test@example.com",
}));

vi.mock("../server/lib/google-calendar.js", () => ({}));

import { buildStatusEventFields } from "./event-action-helpers";

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
