import { describe, expect, it } from "vitest";

import {
  dashboardAnnotationsIssue,
  keyDateEvents,
  panelEventsWithKeyDates,
} from "./key-dates";

const set = (id: string, label: string, extra = {}) => ({
  id,
  dates: [
    {
      id: `${id}-1`,
      setId: id,
      date: "2026-10-14",
      label,
      addedBy: "alice@example.test",
      updatedAt: "2026-10-14T00:00:00.000Z",
      ...extra,
    },
  ],
});

const launches = set("launches", "Product Hunt live", {
  time: "00:01",
  timeZone: "America/Los_Angeles",
});
const changes = set("changes", "Role step first");

describe("keyDateEvents", () => {
  it("turns every set's dates into chart events, keeping time and zone", () => {
    expect(keyDateEvents([launches, changes])).toEqual([
      {
        date: "2026-10-14",
        label: "Product Hunt live",
        time: "00:01",
        timeZone: "America/Los_Angeles",
      },
      { date: "2026-10-14", label: "Role step first" },
    ]);
  });

  it("leaves out the sets a dashboard hides", () => {
    expect(
      keyDateEvents([launches, changes], { hiddenKeyDateSets: ["launches"] }),
    ).toEqual([{ date: "2026-10-14", label: "Role step first" }]);
  });
});

describe("panelEventsWithKeyDates", () => {
  const keyDates = keyDateEvents([launches]);

  it("adds key dates after a time chart's own events", () => {
    const own = { date: "2026-10-01", label: "One-click accounts" };
    expect(
      panelEventsWithKeyDates(
        { chartType: "line", config: { events: [own] } },
        keyDates,
      ),
    ).toEqual([own, ...keyDates]);
  });

  it("does not repeat a key date the panel already lists", () => {
    expect(
      panelEventsWithKeyDates(
        { chartType: "area", config: { events: [...keyDates] } },
        keyDates,
      ),
    ).toEqual(keyDates);
  });

  it("adds key dates to legacy stacked bar and area charts", () => {
    for (const chartType of ["stacked-bar", "stacked-area"]) {
      expect(
        panelEventsWithKeyDates(
          { chartType: chartType as never, config: {} },
          keyDates,
        ),
      ).toEqual(keyDates);
    }
  });

  it("leaves other chart types with only their own events", () => {
    expect(
      panelEventsWithKeyDates({ chartType: "pie", config: {} }, keyDates),
    ).toBeUndefined();
  });
});

describe("dashboardAnnotationsIssue", () => {
  it("accepts absent annotations, hidden set ids and hidden data notes", () => {
    expect(dashboardAnnotationsIssue(undefined)).toBeNull();
    expect(
      dashboardAnnotationsIssue({
        hiddenKeyDateSets: ["launches"],
        hiddenDataNotes: [{ noteId: "note-1", panelId: "p1" }],
      }),
    ).toBeNull();
  });

  it("names the problem in a malformed value", () => {
    expect(dashboardAnnotationsIssue([])).toMatch(/must be an object/);
    expect(dashboardAnnotationsIssue({ hidden: [] })).toMatch(
      /unknown keys: hidden/,
    );
    expect(dashboardAnnotationsIssue({ hiddenKeyDateSets: [""] })).toMatch(
      /hiddenKeyDateSets must be an array/,
    );
  });
});
