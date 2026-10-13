import { describe, expect, it, vi } from "vitest";

const buildDeepLinkMock = vi.hoisted(() =>
  vi.fn(({ to }: { to: string }) => `calendar:${to}`),
);

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: buildDeepLinkMock,
  getRequestTimezone: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
  readSetting: vi.fn(),
}));

vi.mock("../server/lib/calendar-availability.js", () => ({
  eventBlocksAvailability: vi.fn(),
}));

vi.mock("../server/lib/find-time.js", () => ({
  computeFindTimeSlots: vi.fn(),
  normalizeAvailabilitySchedule: vi.fn(),
  normalizeTimezone: vi.fn(),
  resolveFindTimeRange: vi.fn(),
}));

vi.mock("../server/lib/google-calendar.js", () => ({}));

vi.mock("./list-events.js", () => ({ listCalendarEvents: vi.fn() }));

import action from "./find-a-time.js";

describe("find-a-time chat card", () => {
  it("projects the best valid slot and keeps unavailable results as tool rows", () => {
    const result = {
      googleConnected: true,
      errors: [],
      range: { timezone: "America/Los_Angeles" },
      slots: [
        {
          start: "2026-04-23T17:30:00.000Z",
          end: "2026-04-23T18:15:00.000Z",
          durationMin: 45,
        },
      ],
      change: {
        verb: "created",
        kind: "calendar-time-choice",
        title: "Best shared time",
        detail: "Thu, Apr 23 · 10:30 AM–11:15 AM · PT",
        url: "calendar:/home?createSlot=1&start=2026-04-23T17%3A30%3A00.000Z&end=2026-04-23T18%3A15%3A00.000Z&timezone=America%2FLos_Angeles",
      },
    };
    const chatUI = action.chatUI!;

    expect(chatUI.when?.({}, result)).toBe(true);
    expect(chatUI.projectResult?.({}, result)).toMatchObject({
      change: {
        verb: "created",
        kind: "calendar-time-choice",
        title: "Best shared time",
        detail: "Thu, Apr 23 · 10:30 AM–11:15 AM · PT",
        url: "calendar:/home?createSlot=1&start=2026-04-23T17%3A30%3A00.000Z&end=2026-04-23T18%3A15%3A00.000Z&timezone=America%2FLos_Angeles",
      },
    });

    const unavailable = { errors: [{ email: "guest@example.test" }] };
    expect(chatUI.when?.({}, unavailable)).toBe(false);
    expect(chatUI.projectResult?.({}, unavailable)).toBeNull();
  });

  it("formats the choice detail in the caller locale", () => {
    const result = {
      change: {
        verb: "created",
        kind: "calendar-time-choice",
        title: "Best shared time",
        detail: "jeu. 23 avr. · 10:30–11:15 · PT",
        url: "calendar:/home?createSlot=1&start=2026-04-23T17%3A30%3A00.000Z&end=2026-04-23T18%3A15%3A00.000Z&timezone=America%2FLos_Angeles",
      },
    };
    const projected = action.chatUI!.projectResult!({}, result) as {
      change: { detail: string };
    };

    expect(projected.change.detail).toContain("10:30");
    expect(projected.change.detail).not.toMatch(
      /Thu|Apr|AM|America\/Los_Angeles/u,
    );
  });
});
