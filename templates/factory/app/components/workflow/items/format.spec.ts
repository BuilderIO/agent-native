import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createItemsStrings } from "../items-strings";
import {
  dayKey,
  formatClock as clockOf,
  formatDateTime as dateTimeOf,
  formatDayLabel as dayLabelOf,
  formatDuration as durationOf,
  formatPercent,
  formatRelative as relativeOf,
  formatUntil as untilOf,
  shortId,
} from "./format";

const LOCALE = "en-US";
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const s = createItemsStrings(createEnglishTranslator());
const formatClock = (value: string) => clockOf(value, LOCALE);
const formatDateTime = (value: string) => dateTimeOf(value, LOCALE);
const formatDayLabel = (value: string, nowMs: number) =>
  dayLabelOf(value, nowMs, s, LOCALE);
const formatDuration = (ms: number) => durationOf(ms, s);
const formatRelative = (value: string | null | undefined, nowMs: number) =>
  relativeOf(value, nowMs, LOCALE);
const formatUntil = (value: string, nowMs: number) =>
  untilOf(value, nowMs, LOCALE);
const MIN = 60_000;

describe("formatRelative", () => {
  it("reads past and future relative to the clock it is given", () => {
    const past = formatRelative(new Date(NOW - 5 * MIN).toISOString(), NOW);
    const future = formatRelative(new Date(NOW + 40 * MIN).toISOString(), NOW);
    expect(past).toMatch(/5/);
    expect(future).toMatch(/40/);
    expect(past).not.toEqual(future);
  });

  it("returns nothing for a missing stamp and the stored text for an unreadable one", () => {
    expect(formatRelative(null, NOW)).toBeNull();
    expect(formatRelative("", NOW)).toBeNull();
    expect(formatRelative("last tuesday", NOW)).toBe("last tuesday");
  });
});

describe("formatUntil", () => {
  it("shows only the clock for later today and the date for another day", () => {
    const later = new Date(2026, 9, 18, 14, 40).toISOString();
    const tomorrow = new Date(2026, 9, 19, 14, 40).toISOString();
    expect(formatUntil(later, NOW)).toBe(formatClock(later));
    expect(formatUntil(tomorrow, NOW)).toBe(formatDateTime(tomorrow));
    expect(formatUntil("soon", NOW)).toBe("soon");
  });
});

describe("day grouping", () => {
  it("keys by local calendar day", () => {
    const morning = new Date(2026, 9, 18, 0, 5).toISOString();
    const night = new Date(2026, 9, 18, 23, 55).toISOString();
    const next = new Date(2026, 9, 19, 0, 5).toISOString();
    expect(dayKey(morning)).toBe(dayKey(night));
    expect(dayKey(morning)).not.toBe(dayKey(next));
    expect(dayKey(morning)).toBe("2026-10-18");
  });

  it("labels today and yesterday by calendar day, not by 24 hour distance", () => {
    const earlyToday = new Date(2026, 9, 18, 0, 5).toISOString();
    const lateYesterday = new Date(2026, 9, 17, 23, 55).toISOString();
    expect(formatDayLabel(earlyToday, NOW)).toBe("Today");
    expect(formatDayLabel(lateYesterday, NOW)).toBe("Yesterday");
    expect(
      formatDayLabel(new Date(2026, 9, 10, 9).toISOString(), NOW),
    ).not.toMatch(/Today|Yesterday/);
  });
});

describe("formatDuration", () => {
  it("scales from milliseconds to minutes", () => {
    expect(formatDuration(820)).toBe("820 ms");
    expect(formatDuration(2_800)).toBe("2.8 s");
    expect(formatDuration(14_000)).toBe("14 s");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });
});

describe("formatPercent", () => {
  it("does not round a real failure down to zero", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.002)).toBe("<1%");
    expect(formatPercent(0.126)).toBe("13%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("shortId", () => {
  it("keeps both ends of a long id and leaves a short one alone", () => {
    expect(shortId("abc")).toBe("abc");
    const shortened = shortId("0123456789abcdef0123456789", 12);
    expect(shortened).toHaveLength(12);
    expect(shortened.startsWith("012345")).toBe(true);
    expect(shortened.endsWith("56789")).toBe(true);
  });
});
