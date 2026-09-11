import { describe, expect, it } from "vitest";

import { meetingHasEnded, nowMarkerIndex } from "./agenda-card";

const T14_00 = Date.parse("2026-08-14T14:00:00.000Z");

describe("meetingHasEnded", () => {
  // Regression: agenda intentionally shows meetings that already finished
  // today, but relativeStartLabel's "soon" window (up to 2h after start)
  // doesn't know that — without this check a call that ended an hour ago
  // rendered as "Now" with live Join/Open-notes controls.
  it("is true once scheduledEnd has passed, even within relativeStartLabel's 2h soon window", () => {
    expect(
      meetingHasEnded(
        {
          actualEnd: null,
          scheduledEnd: "2026-08-14T13:30:00.000Z", // ended 30 min ago
          scheduledStart: "2026-08-14T13:00:00.000Z",
        },
        T14_00,
      ),
    ).toBe(true);
  });

  it("is true once actualEnd is set, regardless of scheduledEnd", () => {
    expect(
      meetingHasEnded(
        {
          actualEnd: "2026-08-14T13:59:00.000Z",
          scheduledEnd: "2026-08-14T15:00:00.000Z", // ran short of schedule
          scheduledStart: "2026-08-14T13:00:00.000Z",
        },
        T14_00,
      ),
    ).toBe(true);
  });

  it("is false for a meeting still in progress or not yet started", () => {
    expect(
      meetingHasEnded(
        {
          actualEnd: null,
          scheduledEnd: "2026-08-14T14:30:00.000Z",
          scheduledStart: "2026-08-14T13:45:00.000Z",
        },
        T14_00,
      ),
    ).toBe(false);
    expect(
      meetingHasEnded(
        {
          actualEnd: null,
          scheduledEnd: null,
          scheduledStart: "2026-08-14T15:00:00.000Z",
        },
        T14_00,
      ),
    ).toBe(false);
  });

  it("falls back to scheduledStart when no end is known, rather than treating the row as endless", () => {
    expect(
      meetingHasEnded(
        {
          actualEnd: null,
          scheduledEnd: null,
          scheduledStart: "2026-08-14T13:00:00.000Z",
        },
        T14_00,
      ),
    ).toBe(true);
  });
});

describe("nowMarkerIndex", () => {
  it("returns -1 when every meeting is still ahead", () => {
    const meetings = [
      {
        id: "a",
        title: "a",
        scheduledStart: "2026-08-14T15:00:00.000Z",
        scheduledEnd: "2026-08-14T15:30:00.000Z",
      },
    ];
    expect(nowMarkerIndex(meetings, T14_00)).toBe(-1);
  });

  it("returns the first not-yet-finished meeting's index", () => {
    const meetings = [
      {
        id: "a",
        title: "a",
        scheduledStart: "2026-08-14T12:00:00.000Z",
        scheduledEnd: "2026-08-14T12:30:00.000Z",
      },
      {
        id: "b",
        title: "b",
        scheduledStart: "2026-08-14T13:00:00.000Z",
        scheduledEnd: "2026-08-14T13:30:00.000Z",
      },
      {
        id: "c",
        title: "c",
        scheduledStart: "2026-08-14T15:00:00.000Z",
        scheduledEnd: "2026-08-14T15:30:00.000Z",
      },
    ];
    expect(nowMarkerIndex(meetings, T14_00)).toBe(2);
  });
});
