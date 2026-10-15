import { describe, expect, it } from "vitest";

import { resolvePanelEvents } from "./panel-events";
import { unknownPanelConfigKeys } from "./panel-render-contract";

const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

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
