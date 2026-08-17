import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { computeTimedEventLayout } from "./event-layout";

const DAY = new Date("2026-08-10T00:00:00");

function event(
  id: string,
  start: string,
  end: string,
  title = id,
): CalendarEvent {
  return {
    id,
    title,
    description: "",
    start: `2026-08-10T${start}:00`,
    end: `2026-08-10T${end}:00`,
    location: "",
    allDay: false,
    source: "local",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("computeTimedEventLayout", () => {
  it("uses the full column for a single event", () => {
    const layout = computeTimedEventLayout([event("a", "08:00", "10:00")], DAY);

    expect(layout.get("a")).toMatchObject({
      left: 0,
      width: 100,
      col: 0,
      totalCols: 1,
    });
  });

  it("indents the later event while keeping both cards wide", () => {
    const layout = computeTimedEventLayout(
      [event("gym", "16:00", "18:00"), event("friyay", "17:00", "18:00")],
      DAY,
    );

    expect(layout.get("gym")).toMatchObject({
      left: 0,
      width: 100,
      indent: 0,
      col: 0,
    });
    expect(layout.get("friyay")).toMatchObject({
      left: 0,
      width: 100,
      indent: 16,
      col: 1,
      totalCols: 2,
    });
  });

  it("adds another inset layer for simultaneous events", () => {
    const layout = computeTimedEventLayout(
      [event("a", "09:00", "11:00"), event("b", "09:20", "10:00")],
      DAY,
    );

    expect(layout.get("a")).toMatchObject({
      left: 0,
      width: 100,
      indent: 0,
      col: 0,
    });
    expect(layout.get("b")).toMatchObject({
      left: 0,
      width: 100,
      indent: 16,
      col: 1,
    });
  });

  it("keeps adjacent events in the same layer", () => {
    const layout = computeTimedEventLayout(
      [event("a", "08:00", "08:45"), event("b", "08:45", "09:45")],
      DAY,
    );

    expect(layout.get("a")).toMatchObject({ left: 0, width: 100, indent: 0 });
    expect(layout.get("b")).toMatchObject({ left: 0, width: 100, indent: 0 });
  });

  it("accounts for the minimum rendered height of short events", () => {
    const layout = computeTimedEventLayout(
      [event("a", "08:00", "08:05"), event("b", "08:06", "08:11")],
      DAY,
    );

    expect(layout.get("a")).toMatchObject({ left: 0, width: 100, indent: 0 });
    expect(layout.get("b")).toMatchObject({ left: 0, width: 100, indent: 16 });
  });

  it("reuses a free overlap layer after an earlier event ends", () => {
    const layout = computeTimedEventLayout(
      [
        event("background", "08:00", "12:00"),
        event("early", "08:15", "09:00"),
        event("later", "09:30", "10:30"),
      ],
      DAY,
    );

    expect(layout.get("early")).toMatchObject({ col: 1, indent: 16 });
    expect(layout.get("later")).toMatchObject({ col: 1, indent: 16 });
  });

  it("does not create a third column for a chained overlap", () => {
    const layout = computeTimedEventLayout(
      [
        event("first", "08:00", "08:50"),
        event("middle", "08:30", "09:15"),
        event("last", "09:00", "09:45"),
      ],
      DAY,
    );

    expect(layout.get("first")).toMatchObject({
      col: 0,
      indent: 0,
      totalCols: 2,
    });
    expect(layout.get("middle")).toMatchObject({
      col: 1,
      indent: 16,
      totalCols: 2,
    });
    expect(layout.get("last")).toMatchObject({
      col: 0,
      indent: 0,
      totalCols: 2,
    });
  });

  it("uses the visible day segment when laying out overnight events", () => {
    const overnight = event("overnight", "00:00", "10:00");
    overnight.start = "2026-08-09T23:00:00";
    const later = event("later", "08:30", "09:30");

    const layout = computeTimedEventLayout([overnight, later], DAY);

    expect(layout.get("overnight")).toMatchObject({
      left: 0,
      width: 100,
      indent: 0,
    });
    expect(layout.get("later")).toMatchObject({
      left: 0,
      width: 100,
      indent: 16,
    });
  });
});
