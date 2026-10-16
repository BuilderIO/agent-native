import { describe, expect, it } from "vitest";

import {
  formatPanelEventTime,
  formatPanelEventWhen,
  groupPanelEvents,
  isIsoCalendarDate,
  isValidPanelEvent,
  panelEventInstant,
  panelEventProblem,
  resolvePanelEvents,
} from "./panel-events";
import { unknownPanelConfigKeys } from "./panel-render-contract";

const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

// The Oct 14, 2026 Agent-Native launch: two moments on one day.
const productHunt = {
  date: "2026-10-14",
  time: "00:01",
  timeZone: "America/Los_Angeles",
  label: "Product Hunt live",
};
const launchPosts = {
  date: "2026-10-14",
  time: "12:00",
  timeZone: "America/New_York",
  label: "Launch posts on X, LinkedIn",
};

describe("resolvePanelEvents", () => {
  it("snaps to the nearest x value and keeps the label", () => {
    const [event] = resolvePanelEvents(
      [{ date: "2026-10-14", label: "Launch" }],
      days,
    );
    expect(event).toMatchObject({ index: 2, x: "2026-10-14", label: "Launch" });
  });

  it("snaps a date missing from the data", () => {
    const weekly = ["2026-10-05", "2026-10-12", "2026-10-19"];
    const [event] = resolvePanelEvents(
      [{ date: "2026-10-14", label: "Launch" }],
      weekly,
    );
    expect(event.x).toBe("2026-10-12");
  });

  it("hides events outside the visible range and non-date axes", () => {
    expect(
      resolvePanelEvents([{ date: "2026-11-01", label: "Late" }], days),
    ).toEqual([]);
    expect(
      resolvePanelEvents([{ date: "2026-10-14", label: "x" }], ["a", "b"]),
    ).toEqual([]);
  });

  it("skips rows whose x is not a date and keeps their row positions", () => {
    const [event] = resolvePanelEvents(
      [{ date: "2026-10-14", label: "Launch" }],
      ["2026-10-12", null, "2026-10-14", "Total"],
    );
    expect(event).toMatchObject({ index: 2, x: "2026-10-14" });
  });

  it("keeps a daily axis of local midnights daily across a daylight-saving change", () => {
    // US clocks spring forward on 2026-03-08, so that day is 23 hours long.
    const newYork = [
      "2026-03-06T00:00:00-05:00",
      "2026-03-07T00:00:00-05:00",
      "2026-03-08T00:00:00-05:00",
      "2026-03-09T00:00:00-04:00",
      "2026-03-10T00:00:00-04:00",
    ];
    const marked = (xValues: string[], dates: string[]) =>
      resolvePanelEvents(
        dates.map((date) => ({ date, label: date })),
        xValues,
      ).map((event) => event.x.slice(0, 10));
    expect(marked(newYork, ["2026-03-08", "2026-03-09"])).toEqual([
      "2026-03-08",
      "2026-03-09",
    ]);
    // East of UTC, local midnight falls on the previous UTC day.
    const berlin = [
      "2026-03-28T00:00:00+01:00",
      "2026-03-29T00:00:00+01:00",
      "2026-03-30T00:00:00+02:00",
    ];
    expect(marked(berlin, ["2026-03-29", "2026-03-30"])).toEqual([
      "2026-03-29",
      "2026-03-30",
    ]);
  });
});

describe("isIsoCalendarDate", () => {
  it("rejects days that do not exist instead of rolling them over", () => {
    expect(isIsoCalendarDate("2026-10-14")).toBe(true);
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(isIsoCalendarDate("2026-13-01")).toBe(false);
    expect(isValidPanelEvent({ date: "2026-02-30", label: "Launch" })).toBe(
      false,
    );
  });
});

describe("event time of day", () => {
  it("places a timed event at its instant in its own time zone", () => {
    expect(new Date(panelEventInstant(productHunt)).toISOString()).toBe(
      "2026-10-14T07:01:00.000Z",
    );
    expect(new Date(panelEventInstant(launchPosts)).toISOString()).toBe(
      "2026-10-14T16:00:00.000Z",
    );
  });

  it("formats the time in the event's zone", () => {
    expect(formatPanelEventTime(productHunt, "en-US")).toBe("12:01 AM PT");
    expect(formatPanelEventTime(launchPosts, "en-US")).toBe("12:00 PM ET");
    expect(formatPanelEventTime({ date: "2026-10-14" }, "en-US")).toBeNull();
  });

  it("dates an event that is not on the header's day, timed or not", () => {
    const when = (event: Parameters<typeof formatPanelEventWhen>[0]) =>
      formatPanelEventWhen(event, "2026-10-12", "en-US");
    expect(when(productHunt)).toBe("Oct 14, 2026, 12:01 AM PT");
    expect(when({ date: "2026-10-13" })).toBe("Oct 13, 2026");
    expect(when({ ...productHunt, date: "2026-10-12" })).toBe("12:01 AM PT");
    expect(when({ date: "2026-10-12" })).toBeNull();
  });

  it("rejects a time the clocks skip springing forward, and says why", () => {
    const skipped = {
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
      label: "Clocks change",
    };
    expect(isValidPanelEvent(skipped)).toBe(false);
    expect(panelEventProblem(skipped)).toBe(
      "time 02:30 does not exist on 2026-03-08 in America/New_York: the clocks skip it for daylight saving",
    );
    expect(() => panelEventInstant(skipped)).toThrow(RangeError);
    expect(resolvePanelEvents([skipped], ["2026-03-07", "2026-03-08"])).toEqual(
      [],
    );
    expect(isValidPanelEvent({ ...skipped, time: "03:30" })).toBe(true);
    expect(isValidPanelEvent({ ...skipped, timeZone: undefined })).toBe(true);
  });

  it("puts a time the clocks show twice falling back at its first occurrence", () => {
    const instant = (date: string, time: string, timeZone: string) =>
      new Date(panelEventInstant({ date, time, timeZone })).toISOString();
    // 01:30 EDT, before New York falls back to EST at 02:00 EDT.
    expect(instant("2026-11-01", "01:30", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    // 02:30 CEST, before Berlin falls back to CET at 03:00 CEST.
    expect(instant("2026-10-25", "02:30", "Europe/Berlin")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("puts both launch moments on the same day of a daily axis", () => {
    const resolved = resolvePanelEvents([launchPosts, productHunt], days);
    expect(resolved.map((event) => event.x)).toEqual([
      "2026-10-14",
      "2026-10-14",
    ]);
  });

  it("puts each moment in its own bucket on an hourly axis", () => {
    const hours = Array.from(
      { length: 24 },
      (_, hour) => `2026-10-14 ${String(hour).padStart(2, "0")}:00:00`,
    );
    const resolved = resolvePanelEvents([productHunt, launchPosts], hours);
    expect(resolved.map((event) => event.x)).toEqual([
      "2026-10-14 07:00:00",
      "2026-10-14 16:00:00",
    ]);
  });

  it("puts an untimed event on the first hour written on its date when the hours carry an offset", () => {
    const pacific = ["2026-10-14", "2026-10-15"].flatMap((date) =>
      Array.from(
        { length: 24 },
        (_, hour) => `${date}T${String(hour).padStart(2, "0")}:00:00-07:00`,
      ),
    );
    const marked = (date: string) =>
      resolvePanelEvents([{ date, label: date }], pacific).map(
        (event) => event.x,
      );
    // UTC midnight on Oct 14 is 5 PM the day before, ahead of the first row.
    expect(marked("2026-10-14")).toEqual(["2026-10-14T00:00:00-07:00"]);
    // UTC midnight on Oct 15 and 16 is 5 PM on the 14th and 15th here.
    expect(marked("2026-10-15")).toEqual(["2026-10-15T00:00:00-07:00"]);
    expect(marked("2026-10-16")).toEqual([]);
  });

  it("puts an untimed event on the first visible hour of a window that starts later in its day", () => {
    const workday = [
      null,
      ...Array.from(
        { length: 9 },
        (_, hour) => `2026-10-14 ${String(hour + 9).padStart(2, "0")}:00:00`,
      ),
    ];
    const resolved = resolvePanelEvents(
      [{ date: "2026-10-14", label: "Launch" }, productHunt, launchPosts],
      workday,
    );
    // Product Hunt went live at 07:01 UTC, before the window opens.
    expect(
      resolved.map(({ index, x, label }) => ({ index, x, label })),
    ).toEqual([
      { index: 1, x: "2026-10-14 09:00:00", label: "Launch" },
      {
        index: 8,
        x: "2026-10-14 16:00:00",
        label: "Launch posts on X, LinkedIn",
      },
    ]);
  });

  it("ignores a time zone without a time, and unknown zones", () => {
    expect(
      resolvePanelEvents(
        [
          { date: "2026-10-14", timeZone: "America/New_York", label: "a" },
          {
            date: "2026-10-14",
            time: "12:00",
            timeZone: "Mars/Base",
            label: "b",
          },
          { date: "2026-10-14", time: "25:00", label: "c" },
        ],
        days,
      ),
    ).toEqual([]);
  });
});

describe("groupPanelEvents", () => {
  it("groups same-day events into one marker, in time order", () => {
    const groups = groupPanelEvents(
      resolvePanelEvents(
        [launchPosts, { date: "2026-10-12", label: "Earlier" }, productHunt],
        days,
      ),
    );
    expect(groups.map((group) => group.x)).toEqual([
      "2026-10-12",
      "2026-10-14",
    ]);
    expect(groups[1].events.map((event) => event.label)).toEqual([
      "Product Hunt live",
      "Launch posts on X, LinkedIn",
    ]);
  });
});

describe("config.events contract", () => {
  const panel = (events: unknown, chartType = "area") => ({
    id: "p",
    title: "P",
    sql: "select 1",
    source: "bigquery",
    chartType,
    width: 1,
    config: { events },
  });

  it("accepts valid events on a date chart", () => {
    expect(
      unknownPanelConfigKeys(panel([{ date: "2026-10-14", label: "Launch" }])),
    ).toEqual([]);
    expect(unknownPanelConfigKeys(panel([productHunt, launchPosts]))).toEqual(
      [],
    );
  });

  it("names a skipped daylight-saving time in the rejection", () => {
    const [issue] = unknownPanelConfigKeys(
      panel([
        { date: "2026-10-14", label: "Launch" },
        {
          date: "2026-03-08",
          time: "02:30",
          timeZone: "America/New_York",
          label: "Clocks change",
        },
      ]),
    );
    expect(issue).toMatchObject({ kind: "invalid-value", key: "events" });
    expect(issue.message).toContain(
      "config.events[1]: time 02:30 does not exist on 2026-03-08 in America/New_York",
    );
  });

  it("rejects malformed events and unsupported chart types", () => {
    expect(
      unknownPanelConfigKeys(panel([{ date: "10/14", label: "x" }])),
    ).toEqual([
      expect.objectContaining({ kind: "invalid-value", key: "events" }),
    ]);
    expect(
      unknownPanelConfigKeys(
        panel([{ date: "2026-10-14", label: "x" }], "table"),
      ),
    ).toEqual([expect.objectContaining({ kind: "wrong-chart-type" })]);
  });
});
