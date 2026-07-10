import type { CalendarEvent } from "@shared/api";
import {
  CALENDAR_COLORS,
  DEFAULT_CALENDAR_VIEW_PREFERENCES,
  normalizeCalendarViewPreferences,
} from "@shared/calendar-view-preferences";
import { describe, expect, it } from "vitest";

import { getEventDisplayColor } from "./event-colors";

const googleEvent: CalendarEvent = {
  id: "google-1",
  title: "Team sync",
  description: "",
  location: "",
  start: "2026-05-06T15:00:00.000Z",
  end: "2026-05-06T15:30:00.000Z",
  allDay: false,
  source: "google",
  accountEmail: "steve@builder.io",
  attendees: [
    { email: "steve@builder.io", self: true },
    { email: "alex@builder.io" },
  ],
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

describe("calendar view preferences", () => {
  it("normalizes invalid values back to defaults", () => {
    expect(
      normalizeCalendarViewPreferences({
        hideWeekends: true,
        colorMode: "rainbow" as any,
        singleColor: "blue",
        accountColors: {
          "alice@example.com": "#4ECDC4",
          "bad@example.com": "green",
        },
      }),
    ).toEqual({
      ...DEFAULT_CALENDAR_VIEW_PREFERENCES,
      hideWeekends: true,
      accountColors: {
        "alice@example.com": "#4ECDC4",
      },
    });
  });

  it("uses the single local display color without changing overlay event colors", () => {
    const preferences = {
      hideWeekends: false,
      colorMode: "single" as const,
      singleColor: "#CD6B6B",
    };

    expect(getEventDisplayColor(googleEvent, preferences)).toBe("#CD6B6B");
    expect(
      getEventDisplayColor(
        {
          ...googleEvent,
          overlayEmail: "teammate@example.com",
          color: "#4ECDC4",
        },
        preferences,
      ),
    ).toBe("#4ECDC4");
  });

  it("uses connected account colors independently in single-color mode", () => {
    const preferences = {
      hideWeekends: false,
      colorMode: "single" as const,
      singleColor: "#CD6B6B",
      accountColors: {
        "steve@builder.io": "#4ECDC4",
        "alice@builder.io": "#B07CC6",
      },
    };

    expect(getEventDisplayColor(googleEvent, preferences)).toBe("#4ECDC4");
    expect(
      getEventDisplayColor(
        {
          ...googleEvent,
          id: "google-2",
          accountEmail: "alice@builder.io",
        },
        preferences,
      ),
    ).toBe("#B07CC6");
  });

  it("uses overlay person colors for their visible event blocks", () => {
    expect(
      getEventDisplayColor({
        ...googleEvent,
        overlayEmail: "teammate@example.com",
        ownerColor: "#4ECDC4",
      }),
    ).toBe("#4ECDC4");
  });

  it("falls back to the event color for overlay events without a person color", () => {
    expect(
      getEventDisplayColor(
        {
          ...googleEvent,
          overlayEmail: "teammate@example.com",
          color: "#CD6B6B",
        },
        {
          colorMode: "single",
          singleColor: "#B07CC6",
          accountColors: {
            "steve@builder.io": "#4ECDC4",
          },
        },
      ),
    ).toBe("#CD6B6B");
  });

  it("keeps overlay person colors independent from connected account colors", () => {
    expect(
      getEventDisplayColor(
        {
          ...googleEvent,
          overlayEmail: "teammate@example.com",
          ownerColor: "#B07CC6",
        },
        {
          colorMode: "single",
          singleColor: "#CD6B6B",
          accountColors: {
            "steve@builder.io": "#4ECDC4",
          },
        },
      ),
    ).toBe("#B07CC6");
  });

  it("resolves a distinct color per connected account", () => {
    const preferences = {
      hideWeekends: false,
      colorMode: "multi" as const,
      singleColor: CALENDAR_COLORS[0],
      accountColorModes: {
        "steve@builder.io": "single" as const,
        "alex@builder.io": "single" as const,
      },
      accountColors: {
        "steve@builder.io": "#D4A053",
        "alex@builder.io": "#CD6B6B",
      },
    };

    expect(getEventDisplayColor(googleEvent, preferences)).toBe("#D4A053");
    expect(
      getEventDisplayColor(
        { ...googleEvent, accountEmail: "alex@builder.io" },
        preferences,
      ),
    ).toBe("#CD6B6B");
  });

  it("falls back to the legacy global single color for accounts with no explicit choice", () => {
    const preferences = normalizeCalendarViewPreferences({
      colorMode: "single",
      singleColor: "#4ECDC4",
    });

    expect(getEventDisplayColor(googleEvent, preferences)).toBe("#4ECDC4");
  });

  it("respects a per-account 'multi' choice over the legacy global single color", () => {
    const preferences = normalizeCalendarViewPreferences({
      colorMode: "single",
      singleColor: "#4ECDC4",
      accountColorModes: { "steve@builder.io": "multi" },
    });

    expect(getEventDisplayColor(googleEvent, preferences)).toBe(
      getEventDisplayColor(googleEvent),
    );
  });
});
