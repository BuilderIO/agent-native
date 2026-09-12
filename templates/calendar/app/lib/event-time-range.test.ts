import { describe, expect, it } from "vitest";

import {
  addMinutesToTimeValue,
  applyEndTimeChange,
  buildTimeOptions,
  eventDurationMinutes,
  shiftEndForStartChange,
  TIME_SLOTS,
  timeValueToMinutes,
  wrappedDurationMinutes,
} from "./event-time-range";

describe("buildTimeOptions", () => {
  it("lists the full day from midnight when no start is given", () => {
    const options = buildTimeOptions({ value: "09:30" });
    expect(options).toHaveLength(96);
    expect(options[0]).toBe("00:00");
    expect(options[options.length - 1]).toBe("23:45");
  });

  it("starts the list at the first slot after the selected start time", () => {
    const options = buildTimeOptions({ value: "09:30", after: "13:30" });
    expect(options[0]).toBe("13:45");
    expect(options[1]).toBe("14:00");
  });

  it("wraps past midnight so every option is later than the start", () => {
    const options = buildTimeOptions({ value: "14:00", after: "13:30" });
    expect(options).toHaveLength(96);
    for (const option of options) {
      const duration = wrappedDurationMinutes("13:30", option);
      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThan(0);
    }
    expect(options[options.length - 1]).toBe("13:30");
  });

  it("never offers an option at or before the start within the same day", () => {
    const options = buildTimeOptions({ value: "14:00", after: "13:30" });
    const sameDayEarlier = options.filter((option) => {
      const minutes = timeValueToMinutes(option);
      return minutes !== null && minutes > 0 && minutes <= 13 * 60 + 30;
    });
    // Those slots still appear, but only after the midnight wrap.
    const firstWrapIndex = options.indexOf("00:00");
    for (const option of sameDayEarlier) {
      expect(options.indexOf(option)).toBeGreaterThan(firstWrapIndex);
    }
  });

  it("keeps an off-slot selection visible in the list", () => {
    const options = buildTimeOptions({ value: "13:37", after: "13:30" });
    expect(options[0]).toBe("13:37");
    expect(options).toHaveLength(97);
  });

  it("rotates from an off-slot start to the next real slot", () => {
    const options = buildTimeOptions({ value: "14:00", after: "13:37" });
    expect(options[0]).toBe("13:45");
  });

  it("falls back to the plain list for an unparseable start", () => {
    const options = buildTimeOptions({ value: "09:30", after: "not-a-time" });
    expect(options).toEqual([...TIME_SLOTS]);
  });
});

describe("wrappedDurationMinutes", () => {
  it("measures a normal same-day span", () => {
    expect(wrappedDurationMinutes("13:30", "14:00")).toBe(30);
  });

  it("treats an earlier end as the next day", () => {
    expect(wrappedDurationMinutes("13:30", "09:30")).toBe(20 * 60);
  });

  it("treats an identical end as a full day", () => {
    expect(wrappedDurationMinutes("13:30", "13:30")).toBe(24 * 60);
  });

  it("reports null instead of a plausible zero for bad input", () => {
    expect(wrappedDurationMinutes("13:30", "oops")).toBeNull();
  });
});

describe("shiftEndForStartChange", () => {
  const range = {
    date: "2026-03-10",
    startTime: "09:00",
    endDate: "2026-03-10",
    endTime: "09:30",
  };

  it("pushes the end forward when the start moves past it", () => {
    expect(shiftEndForStartChange(range, "13:30")).toEqual({
      date: "2026-03-10",
      startTime: "13:30",
      endDate: "2026-03-10",
      endTime: "14:00",
    });
  });

  it("preserves a longer duration when the start moves past the end", () => {
    const twoHours = { ...range, endTime: "11:00" };
    expect(shiftEndForStartChange(twoHours, "16:00").endTime).toBe("18:00");
  });

  it("leaves a still-valid end untouched", () => {
    const wide = { ...range, endTime: "17:00" };
    expect(shiftEndForStartChange(wide, "10:00")).toEqual({
      ...wide,
      startTime: "10:00",
    });
  });

  it("rolls the end date over midnight", () => {
    const late = { ...range, startTime: "22:00", endTime: "23:00" };
    expect(shiftEndForStartChange(late, "23:30")).toEqual({
      date: "2026-03-10",
      startTime: "23:30",
      endDate: "2026-03-11",
      endTime: "00:30",
    });
  });

  it("never produces an end at or before the start", () => {
    for (const slot of TIME_SLOTS) {
      const next = shiftEndForStartChange(range, slot);
      const duration = eventDurationMinutes(next);
      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThan(0);
    }
  });

  it("keeps a multi-day end when it is already after the new start", () => {
    const multiDay = { ...range, endDate: "2026-03-12", endTime: "09:00" };
    expect(shiftEndForStartChange(multiDay, "23:45")).toEqual({
      ...multiDay,
      startTime: "23:45",
    });
  });
});

describe("applyEndTimeChange", () => {
  const range = {
    date: "2026-03-10",
    startTime: "13:30",
    endDate: "2026-03-10",
    endTime: "14:00",
  };

  it("keeps the same day for an end after the start", () => {
    expect(applyEndTimeChange(range, "15:00")).toEqual({
      ...range,
      endTime: "15:00",
    });
  });

  it("rolls a wrapped pick onto the next day instead of inverting the event", () => {
    expect(applyEndTimeChange(range, "09:30")).toEqual({
      ...range,
      endDate: "2026-03-11",
      endTime: "09:30",
    });
  });

  it("treats an end equal to the start as a full day", () => {
    const next = applyEndTimeChange(range, "13:30");
    expect(next.endDate).toBe("2026-03-11");
    expect(eventDurationMinutes(next)).toBe(24 * 60);
  });

  it("never produces an end at or before the start for any offered option", () => {
    for (const slot of buildTimeOptions({ value: "14:00", after: "13:30" })) {
      const duration = eventDurationMinutes(applyEndTimeChange(range, slot));
      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThan(0);
    }
  });
});

describe("addMinutesToTimeValue", () => {
  it("crosses a month boundary", () => {
    expect(addMinutesToTimeValue("2026-03-31", "23:30", 60)).toEqual({
      date: "2026-04-01",
      time: "00:30",
    });
  });

  it("reports null for an unparseable date", () => {
    expect(addMinutesToTimeValue("nope", "09:00", 30)).toBeNull();
  });
});
