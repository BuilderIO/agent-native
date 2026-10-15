import { describe, expect, it } from "vitest";

import {
  formatPanelEventTime,
  groupPanelEvents,
  isIsoCalendarDate,
  isValidPanelEvent,
  panelEventInstant,
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
