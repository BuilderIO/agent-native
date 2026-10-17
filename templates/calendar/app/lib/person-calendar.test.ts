import { describe, expect, it } from "vitest";

import { isPersonCalendarId } from "./person-calendar";

describe("isPersonCalendarId", () => {
  it("treats a plain user address as a person", () => {
    expect(isPersonCalendarId("jordan@builder.io")).toBe(true);
    expect(isPersonCalendarId("Jordan@Builder.IO")).toBe(true);
  });

  it("rejects user-created group calendars", () => {
    expect(isPersonCalendarId("c_abc123@group.calendar.google.com")).toBe(
      false,
    );
  });

  it("rejects room and equipment calendars", () => {
    expect(isPersonCalendarId("c_188x@resource.calendar.google.com")).toBe(
      false,
    );
  });

  it("rejects ids that are not addresses at all", () => {
    expect(isPersonCalendarId("primary")).toBe(false);
    expect(isPersonCalendarId("")).toBe(false);
  });
});
