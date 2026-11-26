import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCalendarReminderSource,
  reminderOverrideFor,
  setCalendarReminderSource,
} from "./calendar-reminders.js";

afterEach(() => setCalendarReminderSource(null));

describe("the reminder a booking carries onto a calendar", () => {
  it("says nothing when the host keeps the calendar's own reminders", async () => {
    expect(await reminderOverrideFor("host@example.com")).toBeUndefined();
    setCalendarReminderSource(async () => undefined);
    expect(await reminderOverrideFor("host@example.com")).toBeUndefined();
    expect(getCalendarReminderSource()).toBeTruthy();
  });

  it("turns reminders off with null, which is not the same as no opinion", async () => {
    setCalendarReminderSource(async () => null);
    expect(await reminderOverrideFor("host@example.com")).toBeNull();
  });

  it("passes the chosen minutes and drops nonsense", async () => {
    const source = vi.fn(async () => [10, 30, -5, Number.NaN, 60]);
    setCalendarReminderSource(source);
    expect(await reminderOverrideFor("host@example.com")).toEqual([10, 30, 60]);
    expect(source).toHaveBeenCalledWith({ hostEmail: "host@example.com" });
  });

  it("treats a loader that throws as no opinion rather than failing the booking", async () => {
    setCalendarReminderSource(async () => {
      throw new Error("profile unavailable");
    });
    expect(await reminderOverrideFor("host@example.com")).toBeUndefined();
  });
});
