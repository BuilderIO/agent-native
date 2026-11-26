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

  it("rejects Google's holiday, birthday and imported calendars", () => {
    expect(
      isPersonCalendarId("en.eg#holiday@group.v.calendar.google.com"),
    ).toBe(false);
    expect(
      isPersonCalendarId("en.usa#holiday@group.v.calendar.google.com"),
    ).toBe(false);
    expect(
      isPersonCalendarId("addressbook#contacts@group.v.calendar.google.com"),
    ).toBe(false);
    expect(isPersonCalendarId("c_abc@import.calendar.google.com")).toBe(false);
  });

  it("keeps addresses on domains that only end like Google's", () => {
    expect(isPersonCalendarId("jordan@notcalendar.google.com")).toBe(true);
  });

  it("rejects ids that are not addresses at all", () => {
    expect(isPersonCalendarId("primary")).toBe(false);
    expect(isPersonCalendarId("")).toBe(false);
  });
});
