import { describe, expect, it } from "vitest";

import { normalizeCalendarSettings } from "./settings";

describe("calendar settings", () => {
  it("adds the Sunday-first default to existing settings", () => {
    expect(
      normalizeCalendarSettings({
        timezone: "Europe/London",
        bookingPageTitle: "Meet",
        bookingPageDescription: "Choose a time.",
        defaultEventDuration: 45,
      }),
    ).toEqual({
      timezone: "Europe/London",
      bookingPageTitle: "Meet",
      bookingPageDescription: "Choose a time.",
      defaultEventDuration: 45,
      weekStart: "sunday",
      eventRules: { accept: "", decline: "", hide: "" },
      hiddenEventKeys: [],
      eventRuleActivity: [],
    });
  });

  it("bounds invitation prompts and hidden event identities", () => {
    const settings = normalizeCalendarSettings({
      eventRules: { accept: "x".repeat(2100), decline: 4, hide: "hide" },
      hiddenEventKeys: ["event", 1],
    });
    expect(settings.eventRules).toEqual({
      accept: "x".repeat(2000),
      decline: "",
      hide: "hide",
    });
    expect(settings.hiddenEventKeys).toEqual(["event"]);
  });

  it("keeps only recent, valid invitation-rule activity", () => {
    const settings = normalizeCalendarSettings({
      eventRuleActivity: [
        ...Array.from({ length: 52 }, (_, index) => ({
          id: `activity-${index}`,
          eventId: `event-${index}`,
          accountEmail: "owner@example.com",
          title: "Planning",
          action: "hidden",
          occurredAt: "2026-09-25T12:00:00.000Z",
          hiddenEventKey: `google:owner@example.com:primary:event-${index}`,
        })),
        { id: "bad-activity", action: "accepted" },
      ],
    });

    expect(settings.eventRuleActivity).toHaveLength(50);
    expect(settings.eventRuleActivity?.[0]?.id).toBe("activity-2");
    expect(settings.eventRuleActivity?.[49]?.id).toBe("activity-51");
  });

  it("preserves a valid Monday-first setting", () => {
    expect(normalizeCalendarSettings({ weekStart: "monday" }).weekStart).toBe(
      "monday",
    );
  });

  it("replaces a timezone an older build stored in an unsupported format", () => {
    expect(
      normalizeCalendarSettings({ timezone: "Pacific Standard Time" }).timezone,
    ).toBe("America/New_York");
  });

  it("uses a caller's fallback zone when the stored one is unusable", () => {
    expect(
      normalizeCalendarSettings(
        { timezone: "GMT+2" },
        { timezone: "Pacific/Auckland" },
      ).timezone,
    ).toBe("Pacific/Auckland");
    expect(
      normalizeCalendarSettings({}, { timezone: "Pacific/Auckland" }).timezone,
    ).toBe("Pacific/Auckland");
  });

  it("ignores a fallback that is not a real zone", () => {
    expect(
      normalizeCalendarSettings({}, { timezone: "Pacific Standard Time" })
        .timezone,
    ).toBe("America/New_York");
  });

  it("keeps a stored zone even when a fallback is given", () => {
    expect(
      normalizeCalendarSettings(
        { timezone: "Europe/London" },
        { timezone: "Asia/Tokyo" },
      ).timezone,
    ).toBe("Europe/London");
  });

  it("keeps a valid IANA timezone", () => {
    expect(
      normalizeCalendarSettings({ timezone: "Europe/Warsaw" }).timezone,
    ).toBe("Europe/Warsaw");
  });
});
