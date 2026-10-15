import { describe, expect, it } from "vitest";

import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
  SKIPS_UNTRACKED,
} from "../../shared/annotation-fixtures";
import type { KeyDate, KeyDateSet } from "../../shared/key-dates";
import {
  dataNotePlacement,
  keyDatePlacement,
  SUMMARY_DATES_PER_SET,
  summarizeDashboardAnnotations,
} from "./dashboard-annotation-summary";

const panels = [
  {
    id: "failures",
    title: "Setup failures per day",
    chartType: "line",
    sql: "SELECT day, count(*) FROM events WHERE event_name = 'builder_connect_failed' GROUP BY 1",
  },
  {
    id: "clicks",
    title: "Connect clicks per day",
    chartType: "bar",
    sql: "SELECT day, count(*) FROM events WHERE event_name IN ('builder connect clicked', 'builder_connect_clicked') GROUP BY 1",
  },
  {
    id: "old-clicks",
    title: "Connect clicks (old event)",
    chartType: "area",
    sql: "SELECT day, count(*) FROM events WHERE event_name = 'builder connect clicked' GROUP BY 1",
  },
  {
    id: "channels",
    title: "Signups by channel",
    chartType: "table",
    sql: "SELECT channel, count(*) FROM signups GROUP BY 1",
  },
];

const keyDate = (
  date: string,
  label: string,
  extra: Partial<KeyDate> = {},
): KeyDate => ({
  id: `kd-${date}-${label}`,
  setId: "launches",
  date,
  label,
  addedBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  ...extra,
});

const launches: KeyDateSet = {
  id: "launches",
  name: "Launches",
  createdBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  dates: [
    keyDate("2026-06-01", "Beta waitlist opens"),
    keyDate("2026-07-15", "Docs site launch"),
    keyDate("2026-08-20", "Pricing page launch"),
    keyDate("2026-10-14", "Product Hunt live", {
      time: "00:01",
      timeZone: "America/Los_Angeles",
    }),
    keyDate("2026-10-14", "YouTube launch video", {
      time: "03:30",
      timeZone: "America/New_York",
    }),
    keyDate("2026-10-14", "Introducing Agent-Native Beta blog post", {
      time: "11:00",
      timeZone: "America/New_York",
    }),
    keyDate("2026-10-14", "Launch posts on X, LinkedIn", {
      time: "12:00",
      timeZone: "America/New_York",
    }),
  ],
};

const productChanges: KeyDateSet = {
  ...launches,
  id: "product-changes",
  name: "Product changes",
  dates: [keyDate("2026-09-22", "New onboarding flow")],
};

describe("summarizeDashboardAnnotations", () => {
  it("lists each set's latest dates and whether this dashboard shows it", () => {
    const summary = summarizeDashboardAnnotations(
      "dash",
      { panels, annotations: { hiddenKeyDateSets: ["product-changes"] } },
      [launches, productChanges],
      [],
    );

    expect(summary.keyDateSets).toEqual([
      {
        id: "launches",
        name: "Launches",
        shown: true,
        dateCount: 7,
        recentDates: [
          {
            date: "2026-10-14",
            time: "12:00",
            timeZone: "America/New_York",
            label: "Launch posts on X, LinkedIn",
          },
          {
            date: "2026-10-14",
            time: "11:00",
            timeZone: "America/New_York",
            label: "Introducing Agent-Native Beta blog post",
          },
          {
            date: "2026-10-14",
            time: "03:30",
            timeZone: "America/New_York",
            label: "YouTube launch video",
          },
          {
            date: "2026-10-14",
            time: "00:01",
            timeZone: "America/Los_Angeles",
            label: "Product Hunt live",
          },
          { date: "2026-08-20", label: "Pricing page launch" },
        ],
      },
      {
        id: "product-changes",
        name: "Product changes",
        shown: false,
        dateCount: 1,
        recentDates: [{ date: "2026-09-22", label: "New onboarding flow" }],
      },
    ]);
    expect(summary.keyDateSets[0].recentDates).toHaveLength(
      SUMMARY_DATES_PER_SET,
    );
  });

  it("lists the notes that reach this dashboard by chart, and where it hides them", () => {
    const summary = summarizeDashboardAnnotations(
      "dash",
      {
        panels,
        annotations: {
          hiddenDataNotes: [{ noteId: SETUP_INCIDENT.id, panelId: "failures" }],
        },
      },
      [],
      [SETUP_INCIDENT, CONNECT_UNDERCOUNT, SKIPS_UNTRACKED],
    );

    expect(summary.dataNotes).toEqual([
      {
        id: SETUP_INCIDENT.id,
        kind: "incident",
        title: SETUP_INCIDENT.title,
        status: "fixed",
        startDate: "2026-10-09",
        endDate: "2026-10-13",
        panelIds: [],
        hiddenOnPanelIds: ["failures"],
      },
      {
        id: CONNECT_UNDERCOUNT.id,
        kind: "data",
        title: CONNECT_UNDERCOUNT.title,
        status: "open",
        startDate: "2026-10-02",
        panelIds: ["old-clicks"],
      },
    ]);
  });

  it("counts a note pinned to a chart on this dashboard only", () => {
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: [
        { dashboardId: "dash", panelId: "channels" },
        { dashboardId: "other", panelId: "failures" },
      ],
    };
    const summary = summarizeDashboardAnnotations(
      "dash",
      { panels },
      [],
      [pinned],
    );
    expect(summary.dataNotes.map((note) => note.panelIds)).toEqual([
      ["channels"],
    ]);
  });
});

describe("dataNotePlacement", () => {
  it("names the charts a note shows on and the ones that hide it", () => {
    expect(
      dataNotePlacement(CONNECT_UNDERCOUNT, "dash", {
        panels,
        annotations: {
          hiddenDataNotes: [
            { noteId: CONNECT_UNDERCOUNT.id, panelId: "old-clicks" },
          ],
        },
      }),
    ).toEqual({
      dashboardId: "dash",
      shownOn: [],
      hiddenOn: [
        { panelId: "old-clicks", title: "Connect clicks (old event)" },
      ],
      hint: expect.stringContaining("hides the note"),
    });

    expect(dataNotePlacement(SETUP_INCIDENT, "dash", { panels })).toEqual({
      dashboardId: "dash",
      shownOn: [{ panelId: "failures", title: "Setup failures per day" }],
    });
  });

  it("explains how to fix a note that reaches no chart", () => {
    const placement = dataNotePlacement(
      { ...SETUP_INCIDENT, matchEvents: ["builder connect failed"] },
      "dash",
      { panels },
    );
    expect(placement.shownOn).toEqual([]);
    expect(placement.hint).toContain("exact event name");
  });
});

describe("keyDatePlacement", () => {
  it("says when the dashboard hides the set or has no time charts", () => {
    expect(keyDatePlacement("launches", "dash", { panels })).toEqual({
      dashboardId: "dash",
      setShown: true,
    });
    expect(
      keyDatePlacement("launches", "dash", {
        panels,
        annotations: { hiddenKeyDateSets: ["launches"] },
      }),
    ).toMatchObject({
      setShown: false,
      hint: expect.stringContaining("hides the date's set"),
    });
    expect(
      keyDatePlacement("launches", "dash", { panels: [panels[3]] }),
    ).toMatchObject({
      setShown: true,
      hint: expect.stringContaining("no line, area, bar or combo charts"),
    });
  });
});
