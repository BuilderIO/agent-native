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

const setupFunnel = {
  id: "setup-funnel",
  title: "Setup funnel",
  chartType: "funnel",
  sql: "SELECT step, count(*) FROM events WHERE event_name = 'builder_connect_failed' AND ('{{timeRange}}' = '30d' AND day >= CURRENT_DATE - 30 OR '{{timeRange}}' = '90d' AND day >= CURRENT_DATE - 90) GROUP BY step",
};

const rangedFailures = {
  ...panels[0],
  id: "failures-ranged",
  sql: setupFunnel.sql
    .replace("SELECT step", "SELECT day")
    .replace("GROUP BY step", "GROUP BY day"),
};

const timeRangeFilter = (defaultRange: string) => ({
  id: "timeRange",
  label: "Time range",
  type: "select",
  default: defaultRange,
  options: [
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ],
});

const stackedPanels = [
  { ...panels[1], id: "stacked-clicks", chartType: "stacked-bar" },
  { ...panels[2], id: "stacked-old-clicks", chartType: "stacked-area" },
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

/** SKIPS_UNTRACKED ended Sep 17: recent on Oct 15, stale by December. */
const OCT_15 = Date.parse("2026-10-15T12:00:00.000Z");
const DEC_1 = Date.parse("2026-12-01T12:00:00.000Z");

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

  it("says when no chart here can draw a key date", () => {
    const summarize = (dashboardPanels: typeof panels, sets = [launches]) =>
      summarizeDashboardAnnotations(
        "dash",
        { panels: dashboardPanels },
        sets,
        [],
      );

    expect(summarize([panels[3]])).toMatchObject({
      keyDateSets: [expect.objectContaining({ id: "launches", shown: true })],
      keyDatesHint: expect.stringContaining(
        "no line, area, bar or combo charts",
      ),
    });
    expect(summarize(panels)).not.toHaveProperty("keyDatesHint");
    expect(summarize(stackedPanels)).not.toHaveProperty("keyDatesHint");
    expect(summarize([panels[3]], [])).not.toHaveProperty("keyDatesHint");
  });

  it("orders dates by when they happened in their own zones", () => {
    const tokyo = ["09:00", "10:00", "11:00", "12:00", "13:00"].map((time) =>
      keyDate("2026-10-14", `Tokyo session ${time}`, {
        time,
        timeZone: "Asia/Tokyo",
      }),
    );
    const newYork = keyDate("2026-10-14", "New York session", {
      time: "08:00",
      timeZone: "America/New_York",
    });

    const summary = summarizeDashboardAnnotations(
      "dash",
      { panels },
      [{ ...launches, dates: [...tokyo, newYork] }],
      [],
    );

    expect(
      summary.keyDateSets[0].recentDates?.map(({ label }) => label),
    ).toEqual([
      "New York session",
      "Tokyo session 13:00",
      "Tokyo session 12:00",
      "Tokyo session 11:00",
      "Tokyo session 10:00",
    ]);
  });

  it("counts a date without a time from midnight UTC", () => {
    const summary = summarizeDashboardAnnotations(
      "dash",
      { panels },
      [
        {
          ...launches,
          dates: [
            keyDate("2026-10-13", "Late evening in Los Angeles", {
              time: "20:00",
              timeZone: "America/Los_Angeles",
            }),
            keyDate("2026-10-14", "All day"),
          ],
        },
      ],
      [],
    );

    expect(
      summary.keyDateSets[0].recentDates?.map(({ label }) => label),
    ).toEqual(["Late evening in Los Angeles", "All day"]);
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
      { now: OCT_15 },
    );
    expect(summary.dataNotes.map((note) => note.panelIds)).toEqual([
      ["channels"],
    ]);
  });

  it("never counts a section or extension card, which draw no notes", () => {
    const cards = [
      { id: "intro", title: "Setup", chartType: "section", sql: "" },
      { ...panels[0], id: "widget", chartType: "extension" },
    ];
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: cards.map(({ id }) => ({ dashboardId: "dash", panelId: id })),
    };

    expect(
      summarizeDashboardAnnotations(
        "dash",
        { panels: cards },
        [],
        [pinned, SETUP_INCIDENT],
        { now: OCT_15 },
      ).dataNotes,
    ).toEqual([]);
    const placement = dataNotePlacement(
      SETUP_INCIDENT,
      "dash",
      { panels: cards },
      OCT_15,
    );
    expect(placement.shownOn).toEqual([]);
    expect(placement.hint).toContain("exact event name");
  });

  it("drops a note from charts without a date axis or time range once it is no longer recent, as they do", () => {
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: [
        { dashboardId: "dash", panelId: "failures" },
        { dashboardId: "dash", panelId: "channels" },
      ],
    };
    const notesOn = (now: number) =>
      summarizeDashboardAnnotations("dash", { panels }, [], [pinned], { now })
        .dataNotes;

    expect(notesOn(OCT_15)).toMatchObject([
      { panelIds: ["failures", "channels"] },
    ]);
    expect(notesOn(DEC_1)).toMatchObject([{ panelIds: ["failures"] }]);
    expect(
      summarizeDashboardAnnotations(
        "dash",
        {
          panels,
          annotations: {
            hiddenDataNotes: [{ noteId: pinned.id, panelId: "channels" }],
          },
        },
        [],
        [{ ...pinned, panels: [{ dashboardId: "dash", panelId: "channels" }] }],
        { now: DEC_1 },
      ).dataNotes,
    ).toEqual([]);
  });

  it("lists a note on charts without a date axis by the time range on screen, else the dashboard's default", () => {
    const panelIds = (searchParams?: Record<string, string>) =>
      summarizeDashboardAnnotations(
        "dash",
        { panels: [panels[0], setupFunnel], filters: [timeRangeFilter("30d")] },
        [],
        [SETUP_INCIDENT],
        { now: DEC_1, searchParams },
      ).dataNotes.map((note) => note.panelIds);

    expect(panelIds()).toEqual([["failures"]]);
    expect(panelIds({ f_timeRange: "90d" })).toEqual([
      ["failures", "setup-funnel"],
    ]);
  });

  it("counts a time chart that reads the time range only when the note falls in it", () => {
    const panelIds = (searchParams?: Record<string, string>) =>
      summarizeDashboardAnnotations(
        "dash",
        {
          panels: [panels[0], rangedFailures],
          filters: [timeRangeFilter("30d")],
        },
        [],
        [SETUP_INCIDENT],
        { now: DEC_1, searchParams },
      ).dataNotes.map((note) => note.panelIds);

    expect(panelIds()).toEqual([["failures"]]);
    expect(panelIds({ f_timeRange: "90d" })).toEqual([
      ["failures", "failures-ranged"],
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

  it("leaves out charts without a date axis or time range once the note is no longer recent, and says so", () => {
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: [{ dashboardId: "dash", panelId: "channels" }],
    };

    expect(dataNotePlacement(pinned, "dash", { panels }, OCT_15)).toEqual({
      dashboardId: "dash",
      shownOn: [{ panelId: "channels", title: "Signups by channel" }],
    });
    const stale = dataNotePlacement(pinned, "dash", { panels }, DEC_1);
    expect(stale.shownOn).toEqual([]);
    expect(stale.hint).toContain("only while it is ongoing or for 30 days");
    expect(stale.hint).not.toContain("exact event name");
  });

  it("counts charts without a date axis at the dashboard's default time range, and says how to show the note", () => {
    const placement = (defaultRange: string) =>
      dataNotePlacement(
        SETUP_INCIDENT,
        "dash",
        { panels: [setupFunnel], filters: [timeRangeFilter(defaultRange)] },
        DEC_1,
      );

    expect(placement("90d")).toEqual({
      dashboardId: "dash",
      shownOn: [{ panelId: "setup-funnel", title: "Setup funnel" }],
    });
    const outside = placement("30d");
    expect(outside.shownOn).toEqual([]);
    expect(outside.hint).toContain("overlap their time range");
  });

  it("leaves out a time chart whose time range misses the note, and says how to show it", () => {
    const placement = (defaultRange: string) =>
      dataNotePlacement(
        SETUP_INCIDENT,
        "dash",
        { panels: [rangedFailures], filters: [timeRangeFilter(defaultRange)] },
        DEC_1,
      );

    expect(placement("90d").shownOn).toEqual([
      { panelId: "failures-ranged", title: "Setup failures per day" },
    ]);
    const outside = placement("30d");
    expect(outside.shownOn).toEqual([]);
    expect(outside.hint).toContain("overlap their time range");
  });

  it("gives both reasons for a note hidden on its time chart and too old for its table", () => {
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: ["failures", "channels"].map((panelId) => ({
        dashboardId: "dash",
        panelId,
      })),
    };
    const annotations = {
      hiddenDataNotes: [{ noteId: pinned.id, panelId: "failures" }],
    };

    const placement = dataNotePlacement(
      pinned,
      "dash",
      { panels, annotations },
      DEC_1,
    );

    expect(placement).toMatchObject({
      shownOn: [],
      hiddenOn: [{ panelId: "failures", title: "Setup failures per day" }],
    });
    expect(placement.hint).toContain("hides the note");
    expect(placement.hint).toContain("only while it is ongoing or for 30 days");
  });

  it("keeps a stale note on legacy stacked charts, which render as time charts", () => {
    const pinned = {
      ...SKIPS_UNTRACKED,
      panels: stackedPanels.map(({ id }) => ({
        dashboardId: "dash",
        panelId: id,
      })),
    };

    expect(
      dataNotePlacement(pinned, "dash", { panels: stackedPanels }, DEC_1)
        .shownOn,
    ).toEqual([
      { panelId: "stacked-clicks", title: "Connect clicks per day" },
      { panelId: "stacked-old-clicks", title: "Connect clicks (old event)" },
    ]);
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

  it("counts legacy stacked charts as the time charts they render as", () => {
    expect(
      keyDatePlacement("launches", "dash", { panels: stackedPanels }),
    ).toEqual({ dashboardId: "dash", setShown: true });
  });
});
