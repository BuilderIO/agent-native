import { describe, expect, it, vi } from "vitest";

import { panelTimeRange } from "../app/pages/adhoc/sql-dashboard/interpolate";
import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
  SKIPS_UNTRACKED,
} from "./annotation-fixtures";
import {
  dataNoteAppliesTo,
  dataNoteInRange,
  dataNotesOnChart,
  dataNotesForPanel,
  dataNoteTone,
  formatDataNoteDates,
  hiddenDataNotesIssue,
  resolveDataNoteBands,
  sqlCountsEvent,
  xValuesAreDates,
  type DataNote,
} from "./data-notes";
import { xColumnGrain } from "./panel-events";

const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10),
  );

const panel = (id: string, sql: string) => ({ id, sql });

describe("sqlCountsEvent", () => {
  it("matches the event as a quoted string, in either quote and whatever case the SQL keywords use", () => {
    expect(
      sqlCountsEvent(
        "where event = 'builder connect clicked'",
        "builder connect clicked",
      ),
    ).toBe(true);
    expect(
      sqlCountsEvent(
        'WHERE event IN ("builder_connect_failed")',
        "builder_connect_failed",
      ),
    ).toBe(true);
  });

  it("treats event names that differ only in case as different events", () => {
    expect(sqlCountsEvent("WHERE event = 'Signup'", "signup")).toBe(false);
    expect(sqlCountsEvent('WHERE event = "signup"', "Signup")).toBe(false);
    const signups = { ...SETUP_INCIDENT, matchEvents: ["signup"] };
    expect(
      dataNoteAppliesTo(
        signups,
        "dash",
        panel("p1", "SELECT day, count(*) FROM events WHERE event = 'Signup'"),
      ),
    ).toBe(false);
  });

  it("ignores a name that is only part of another, unquoted, or a regex look-alike", () => {
    expect(
      sqlCountsEvent(
        "where event = 'builder_connect_clicked_twice'",
        "builder_connect_clicked",
      ),
    ).toBe(false);
    expect(
      sqlCountsEvent("select builder_connect_failed", "builder_connect_failed"),
    ).toBe(false);
    expect(sqlCountsEvent("where e = 'ab'", "a+b")).toBe(false);
  });

  it("counts a name the SQL filters on: either side of =, a CASE WHEN, an IN list, or LIKE", () => {
    for (const sql of [
      "WHERE event = 'builder_connect_failed'",
      "WHERE 'builder_connect_failed' = event",
      "SELECT SUM(CASE WHEN event = 'builder_connect_failed' THEN 1 ELSE 0 END)",
      "SELECT COUNTIF(event = 'builder_connect_failed')",
      "SELECT day, event = 'builder_connect_failed' AS failed FROM events",
      "SELECT COUNT(CASE event WHEN 'builder_connect_failed' THEN 1 END)",
      "WHERE event IN ('signup', 'builder_connect_failed', 'app_entered')",
      "WHERE event like 'builder_connect_failed'",
    ]) {
      expect(sqlCountsEvent(sql, "builder_connect_failed"), sql).toBe(true);
    }
    expect(
      sqlCountsEvent("WHERE event = 'user''s signup'", "user's signup"),
    ).toBe(true);
  });

  it("ignores a name the SQL only selects, returns, excludes, comments on, or quotes inside another string", () => {
    for (const sql of [
      "SELECT day, 'builder_connect_failed' AS label, count(*) FROM events",
      "SELECT CASE WHEN ok THEN 'builder_connect_failed' ELSE 'builder_connect_failed' END",
      "WHERE event != 'builder_connect_failed' AND event <> 'builder_connect_failed'",
      "WHERE event NOT IN ('builder_connect_failed') AND event NOT LIKE 'builder_connect_failed'",
      "WHERE event = 'signup' -- was 'builder_connect_failed'",
      "WHERE event = 'signup' /* event = 'builder_connect_failed' */",
      "WHERE note = 'see event = ''builder_connect_failed'''",
      `WHERE note = 'event = "builder_connect_failed"'`,
    ]) {
      expect(sqlCountsEvent(sql, "builder_connect_failed"), sql).toBe(false);
    }
  });

  it("ignores a name under a NOT that wraps its comparison or its parentheses", () => {
    for (const sql of [
      "WHERE NOT event = 'builder_connect_failed'",
      "WHERE NOT (event = 'builder_connect_failed')",
      "WHERE NOT (event = 'signup' OR event = 'builder_connect_failed')",
      "WHERE NOT EXISTS (SELECT 1 FROM e WHERE e.event = 'builder_connect_failed')",
      "SELECT COUNT(CASE WHEN NOT event = 'builder_connect_failed' THEN 1 END)",
    ]) {
      expect(sqlCountsEvent(sql, "builder_connect_failed"), sql).toBe(false);
    }
  });

  it("counts a name again once the NOT's predicate or parentheses end", () => {
    for (const sql of [
      "WHERE NOT (event = 'signup') AND event = 'builder_connect_failed'",
      "WHERE user_id IS NOT NULL AND event = 'builder_connect_failed'",
      "WHERE event NOT IN ('signup') OR event IN ('builder_connect_failed')",
      "WHERE NOT (NOT event = 'builder_connect_failed')",
    ]) {
      expect(sqlCountsEvent(sql, "builder_connect_failed"), sql).toBe(true);
    }
  });

  it("matches LIKE patterns as SQL does: % any run, _ one character, ILIKE in any case", () => {
    const failed = "builder_connect_failed";
    expect(sqlCountsEvent("WHERE event LIKE 'builder_connect_%'", failed)).toBe(
      true,
    );
    expect(sqlCountsEvent("WHERE event LIKE '%_failed'", failed)).toBe(true);
    expect(
      sqlCountsEvent("WHERE event LIKE 'builder_connect_faile_'", failed),
    ).toBe(true);
    expect(sqlCountsEvent("WHERE event ILIKE 'BUILDER_CONNECT%'", failed)).toBe(
      true,
    );
    expect(sqlCountsEvent("WHERE event LIKE 'BUILDER_CONNECT%'", failed)).toBe(
      false,
    );
    expect(sqlCountsEvent("WHERE event LIKE 'signup%'", failed)).toBe(false);
    expect(sqlCountsEvent("WHERE e LIKE 'a+b%'", "aab")).toBe(false);
  });

  it("matches a LIKE pattern of many wildcards without backtracking for ever", () => {
    const pattern = `${"%a".repeat(24)}%b`;
    const name = "a".repeat(80);
    expect(sqlCountsEvent(`WHERE event LIKE '${pattern}'`, name)).toBe(false);
    expect(sqlCountsEvent(`WHERE event LIKE '${pattern}'`, `${name}b`)).toBe(
      true,
    );
    expect(sqlCountsEvent("WHERE event LIKE '%%_failed%'", "x_failed")).toBe(
      true,
    );
    expect(sqlCountsEvent("WHERE event LIKE 'a%b%'", "ab")).toBe(true);
    expect(sqlCountsEvent("WHERE event LIKE 'a%b'", "abc")).toBe(false);
  });
});

describe("dataNoteAppliesTo", () => {
  it("parses each chart's SQL once however many notes check it", () => {
    const panels = ["signup", "connect", "publish"].map((event) => ({
      id: event,
      sql: `SELECT day, count(*) FROM events WHERE event_name = '${event}' -- parse once`,
    }));
    const notes = Array.from({ length: 200 }, (_, index) => ({
      matchEvents: [["signup", "connect", "publish", "other"][index % 4]],
      unlessEvents: [],
      panels: [],
    }));
    const matchAll = vi.spyOn(String.prototype, "matchAll");
    try {
      const placed = notes.flatMap((note) =>
        panels.filter((panel) => dataNoteAppliesTo(note, "dash", panel)),
      );
      const parses = matchAll.mock.calls.length;
      expect(placed).toHaveLength(150);
      expect(parses).toBe(panels.length);
    } finally {
      matchAll.mockRestore();
    }
  });

  it("shows on charts counting the event unless they also count its replacement", () => {
    const old = panel("p1", "where event = 'builder connect clicked'");
    const both = panel(
      "p2",
      "where event in ('builder connect clicked', 'builder_connect_clicked')",
    );
    expect(dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", old)).toBe(true);
    expect(dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", both)).toBe(false);
    const patterned = panel(
      "p3",
      "where event = 'builder connect clicked' or event like 'builder_connect_c%'",
    );
    expect(dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", patterned)).toBe(
      false,
    );
    expect(
      dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", panel("p3", "select 1")),
    ).toBe(false);
  });

  it("ignores event names a chart only labels its rows with, in matchEvents and unlessEvents alike", () => {
    const labelled = panel(
      "p1",
      "SELECT day, 'builder_connect_failed' AS series, count(*) FROM events WHERE event = 'signup' GROUP BY 1",
    );
    expect(dataNoteAppliesTo(SETUP_INCIDENT, "dash", labelled)).toBe(false);
    const replacementLabel = panel(
      "p2",
      "SELECT day, 'builder_connect_clicked' AS renamed_to, count(*) FROM events WHERE event = 'builder connect clicked' GROUP BY 1",
    );
    expect(
      dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", replacementLabel),
    ).toBe(true);
  });

  it("shows on a pinned chart whatever its SQL counts", () => {
    const pinned = {
      ...CONNECT_UNDERCOUNT,
      panels: [{ dashboardId: "dash", panelId: "p3" }],
    };
    expect(dataNoteAppliesTo(pinned, "dash", panel("p3", "select 1"))).toBe(
      true,
    );
    expect(dataNoteAppliesTo(pinned, "other", panel("p3", "select 1"))).toBe(
      false,
    );
  });

  it("drops a note a dashboard hides on that chart only", () => {
    const sql = "where event = 'builder_connect_failed'";
    const annotations = {
      hiddenDataNotes: [{ noteId: SETUP_INCIDENT.id, panelId: "p1" }],
    };
    expect(
      dataNotesForPanel(
        [SETUP_INCIDENT],
        "dash",
        panel("p1", sql),
        annotations,
      ),
    ).toEqual([]);
    expect(
      dataNotesForPanel(
        [SETUP_INCIDENT],
        "dash",
        panel("p2", sql),
        annotations,
      ),
    ).toEqual([SETUP_INCIDENT]);
  });
});

describe("resolveDataNoteBands", () => {
  it("covers a closed note's days on a daily axis, with both edges", () => {
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, days("2026-10-01", 14)),
    ).toEqual([
      { startIndex: 8, endIndex: 12, startEdge: true, endEdge: true },
    ]);
  });

  it("runs an ongoing note to the last point without an end edge", () => {
    expect(
      resolveDataNoteBands(CONNECT_UNDERCOUNT, days("2026-09-28", 17)),
    ).toEqual([
      { startIndex: 4, endIndex: 16, startEdge: true, endEdge: false },
    ]);
  });

  it("starts a note with no known start at the first point, without a start edge", () => {
    expect(
      resolveDataNoteBands(SKIPS_UNTRACKED, days("2026-09-10", 14)),
    ).toEqual([
      { startIndex: 0, endIndex: 7, startEdge: false, endEdge: true },
    ]);
  });

  it("clips a note that started before the chart and hides its start edge", () => {
    expect(resolveDataNoteBands(SETUP_INCIDENT, days("2026-10-11", 7))).toEqual(
      [{ startIndex: 0, endIndex: 2, startEdge: false, endEdge: true }],
    );
  });

  it("covers every weekly bucket that overlaps the note", () => {
    const weeks = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
    expect(resolveDataNoteBands(SETUP_INCIDENT, weeks)).toEqual([
      { startIndex: 1, endIndex: 2, startEdge: true, endEdge: true },
    ]);
  });

  it("reads a week_ending column's dates as the last day of each week", () => {
    const weeks = ["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"];
    expect(resolveDataNoteBands(SETUP_INCIDENT, weeks, "week_ending")).toEqual([
      { startIndex: 2, endIndex: 3, startEdge: true, endEdge: true },
    ]);
    // Labeled by the start of each week, the same dates cover Oct 4–17.
    expect(resolveDataNoteBands(SETUP_INCIDENT, weeks, "week")).toEqual([
      { startIndex: 1, endIndex: 2, startEdge: true, endEdge: true },
    ]);
  });

  it("reads a month_end column's dates as the months they close", () => {
    const months = ["2026-08-31", "2026-09-30", "2026-10-31"];
    expect(resolveDataNoteBands(SETUP_INCIDENT, months, "month_end")).toEqual([
      { startIndex: 2, endIndex: 2, startEdge: true, endEdge: true },
    ]);
  });

  it("covers the same weekly buckets when rows are newest first", () => {
    const weeks = ["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28"];
    expect(resolveDataNoteBands(SETUP_INCIDENT, weeks)).toEqual([
      { startIndex: 1, endIndex: 2, startEdge: true, endEdge: true },
    ]);
  });

  it("draws a newest-first note's end edge at its first row", () => {
    const newestFirst = days("2026-10-11", 6).reverse();
    expect(resolveDataNoteBands(SETUP_INCIDENT, newestFirst)).toEqual([
      { startIndex: 3, endIndex: 5, startEdge: true, endEdge: false },
    ]);
  });

  it("skips a null bucket and a total row, keeping each week's row", () => {
    const weeks = [
      "2026-09-28",
      null,
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "Total",
    ];
    expect(xValuesAreDates(weeks)).toBe(true);
    expect(resolveDataNoteBands(SETUP_INCIDENT, weeks)).toEqual([
      { startIndex: 2, endIndex: 3, startEdge: true, endEdge: true },
    ]);
  });

  it("shades each run of covered rows separately when rows are not in date order", () => {
    // Sorted by count: Oct 1 sits between the note's days and stays unshaded.
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, [
        "2026-10-09",
        "2026-10-01",
        "2026-10-13",
      ]),
    ).toEqual([
      { startIndex: 0, endIndex: 0, startEdge: true, endEdge: true },
      { startIndex: 2, endIndex: 2, startEdge: true, endEdge: true },
    ]);
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, [
        "2026-10-10",
        "2026-10-12",
        "2026-10-01",
        "2026-10-11",
        "2026-10-20",
      ]),
    ).toEqual([
      { startIndex: 0, endIndex: 1, startEdge: true, endEdge: true },
      { startIndex: 3, endIndex: 3, startEdge: true, endEdge: true },
    ]);
  });

  it("closes a band at the chart's ends when rows are not in date order", () => {
    // Oct 9 leads only because it has the most rows; the note's end past Oct 9 isn't on either side.
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, [
        "2026-10-09",
        "2026-10-01",
        "2026-10-02",
      ]),
    ).toEqual([{ startIndex: 0, endIndex: 0, startEdge: true, endEdge: true }]);
  });

  it("steps hourly rows sorted by value by the hour, not by the gaps between rows", () => {
    const oct10 = {
      ...SETUP_INCIDENT,
      startDate: "2026-10-10",
      endDate: "2026-10-10",
    };
    expect(
      resolveDataNoteBands(oct10, [
        "2026-10-09T22:00:00Z",
        "2026-10-10T12:00:00Z",
        "2026-10-10T03:00:00Z",
        "2026-10-09T23:00:00Z",
      ]),
    ).toEqual([{ startIndex: 1, endIndex: 2, startEdge: true, endEdge: true }]);
  });

  it("leaves a null bucket between covered rows unshaded, without an edge on either side", () => {
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, [
        "2026-10-05",
        null,
        "2026-10-12",
        "2026-10-19",
      ]),
    ).toEqual([
      { startIndex: 0, endIndex: 0, startEdge: true, endEdge: false },
      { startIndex: 2, endIndex: 2, startEdge: false, endEdge: true },
    ]);
  });

  it("shades nothing for a note that falls on days the query returned no row for", () => {
    // GROUP BY day leaves out days with no events: Oct 10–12 sit between Oct 8 and Oct 13.
    const between = {
      ...SETUP_INCIDENT,
      startDate: "2026-10-10",
      endDate: "2026-10-12",
    };
    expect(resolveDataNoteBands(between, ["2026-10-08", "2026-10-13"])).toEqual(
      [],
    );
  });

  it("shades only the days a note covers that have rows", () => {
    const partly = {
      ...SETUP_INCIDENT,
      startDate: "2026-10-09",
      endDate: "2026-10-11",
    };
    expect(
      resolveDataNoteBands(partly, ["2026-10-08", "2026-10-11", "2026-10-14"]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
  });

  it("keeps each weekly point to its own week when weeks are missing", () => {
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, [
        "2026-09-28",
        "2026-10-12",
        "2026-10-19",
      ]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, ["2026-09-28", "2026-10-19"]),
    ).toEqual([]);
  });

  it("steps an axis of month starts by its months, quarters, or years", () => {
    const september = {
      ...SETUP_INCIDENT,
      startDate: "2026-09-10",
      endDate: "2026-09-12",
    };
    expect(
      resolveDataNoteBands(september, ["2026-08-01", "2026-10-01"]),
    ).toEqual([]);
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, ["2026-09-01", "2026-10-01"]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
    expect(
      resolveDataNoteBands(september, ["2026-04-01", "2026-07-01"]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
    expect(
      resolveDataNoteBands(SETUP_INCIDENT, ["2025-01-01", "2026-01-01"]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
    // Years and quarters needn't start in January.
    expect(
      resolveDataNoteBands(september, ["2025-04-01", "2026-04-01"]),
    ).toEqual([{ startIndex: 1, endIndex: 1, startEdge: true, endEdge: true }]);
    const june = {
      ...september,
      startDate: "2026-06-10",
      endDate: "2026-06-12",
    };
    expect(resolveDataNoteBands(june, ["2026-02-01", "2026-05-01"])).toEqual([
      { startIndex: 1, endIndex: 1, startEdge: true, endEdge: true },
    ]);
  });

  it("places nothing outside the chart or on an axis that is not dates", () => {
    expect(resolveDataNoteBands(SETUP_INCIDENT, days("2026-09-01", 7))).toEqual(
      [],
    );
    expect(resolveDataNoteBands(SETUP_INCIDENT, ["Signup", "Connect"])).toEqual(
      [],
    );
    expect(xValuesAreDates(["Signup"])).toBe(false);
    expect(xValuesAreDates([])).toBe(false);
  });

  it("does not read numeric categories such as hours or years as dates", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    expect(xValuesAreDates(hours)).toBe(false);
    expect(xValuesAreDates([2024, 2025, 2026])).toBe(false);
    expect(xValuesAreDates(["2026-10-12", 2026])).toBe(false);
    expect(xValuesAreDates(["2026-10-12", "2026"])).toBe(false);
    expect(xValuesAreDates([null, "Total"])).toBe(false);
    expect(resolveDataNoteBands(SKIPS_UNTRACKED, hours)).toEqual([]);
    expect(xValuesAreDates(["2026-10-14 07:00:00", "2026-10-14T08:00Z"])).toBe(
      true,
    );
  });
});

describe("dataNotesOnChart", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const range = { kind: "absent" } as const;
  const between = {
    ...SETUP_INCIDENT,
    id: "note-between",
    startDate: "2026-10-10",
    endDate: "2026-10-12",
  };

  it("shades the notes on its dates, writes out ones between them, and leaves off ones outside", () => {
    const xValues = ["2026-10-08", "2026-10-09", "2026-10-13", "2026-10-14"];
    expect(
      dataNotesOnChart([SKIPS_UNTRACKED, between, SETUP_INCIDENT], xValues, {
        range,
        now,
      }),
    ).toEqual([
      { note: between, bands: [] },
      {
        note: SETUP_INCIDENT,
        bands: [{ startIndex: 1, endIndex: 2, startEdge: true, endEdge: true }],
      },
    ]);
  });

  it("writes out the recent notes when the x axis is not dates", () => {
    expect(
      dataNotesOnChart(
        [SKIPS_UNTRACKED, SETUP_INCIDENT],
        ["Signup", "Connect"],
        { range, now },
      ),
    ).toEqual([{ note: SETUP_INCIDENT, bands: [] }]);
  });

  it("writes out the notes in the chart's time range when the x axis is not dates", () => {
    const december = Date.parse("2026-12-01T12:00:00Z");
    expect(
      dataNotesOnChart([SKIPS_UNTRACKED, SETUP_INCIDENT], ["Signup"], {
        range: {
          kind: "days",
          start: Date.parse("2026-10-01"),
          end: Date.parse("2026-11-01"),
        },
        now: december,
      }),
    ).toEqual([{ note: SETUP_INCIDENT, bands: [] }]);
  });

  it("keeps a daily chart's rows to their own days when they all fall on one weekday", () => {
    const mondays = ["2026-10-05", "2026-10-12"];
    expect(
      dataNotesOnChart([SETUP_INCIDENT], mondays, { xKey: "day", range, now }),
    ).toEqual([
      {
        note: SETUP_INCIDENT,
        bands: [
          { startIndex: 1, endIndex: 1, startEdge: true, endEdge: false },
        ],
      },
    ]);
    expect(
      dataNotesOnChart([SETUP_INCIDENT], mondays, { xKey: "week", range, now }),
    ).toEqual([
      {
        note: SETUP_INCIDENT,
        bands: [{ startIndex: 0, endIndex: 1, startEdge: true, endEdge: true }],
      },
    ]);
  });

  it("shades a lone weekly or monthly row over the whole bucket its column names", () => {
    expect(
      dataNotesOnChart([SETUP_INCIDENT], ["2026-10-05"], {
        xKey: "signup_week",
        range,
        now,
      }),
    ).toEqual([
      {
        note: SETUP_INCIDENT,
        bands: [
          { startIndex: 0, endIndex: 0, startEdge: true, endEdge: false },
        ],
      },
    ]);
    expect(
      dataNotesOnChart([SETUP_INCIDENT], ["2026-10-01"], {
        xKey: "monthStart",
        range,
        now,
      }),
    ).toEqual([
      {
        note: SETUP_INCIDENT,
        bands: [{ startIndex: 0, endIndex: 0, startEdge: true, endEdge: true }],
      },
    ]);
    expect(
      dataNotesOnChart([SETUP_INCIDENT], ["2026-10-05"], {
        xKey: "day",
        range,
        now,
      }),
    ).toEqual([]);
  });
});

describe("xColumnGrain", () => {
  it("reads the grain a column's name gives, and none from a plain date", () => {
    expect(xColumnGrain("day")).toBe("day");
    expect(xColumnGrain("signup_week")).toBe("week");
    expect(xColumnGrain("monthStart")).toBe("month");
    expect(xColumnGrain("Quarters")).toBe("quarter");
    expect(xColumnGrain("date")).toBeNull();
    expect(xColumnGrain("week_or_month")).toBeNull();
  });
});

describe("dataNoteInRange", () => {
  const funnel = {
    sql: "SELECT step, count(*) FROM events WHERE event_name = 'builder_connect_failed' AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '90d' AND event_date >= CURRENT_DATE - INTERVAL '90 days') OR ('{{timeRange}}' = 'custom' AND event_date >= '{{timeRangeStart}}' AND event_date <= '{{timeRangeEnd}}')) GROUP BY step",
  };
  const december = Date.parse("2026-12-01T12:00:00Z");
  const listed = (
    note: Pick<DataNote, "startDate" | "endDate">,
    vars: Record<string, string>,
    now = december,
  ) => dataNoteInRange(note, panelTimeRange(funnel, vars, now), now);

  it("lists an Oct 9–13 note under a 90-day view in December, not a 30-day one", () => {
    expect(listed(SETUP_INCIDENT, { timeRange: "90d" })).toBe(true);
    expect(listed(SETUP_INCIDENT, { timeRange: "30d" })).toBe(false);
  });

  it("counts a preset's days back from today, through today, as CURRENT_DATE does", () => {
    // 30d on Nov 12 starts Oct 13, the note's last day; on Nov 13, the day after.
    const at = (day: string) => Date.parse(`${day}T23:00:00Z`);
    expect(listed(SETUP_INCIDENT, { timeRange: "30d" }, at("2026-11-12"))).toBe(
      true,
    );
    expect(listed(SETUP_INCIDENT, { timeRange: "30d" }, at("2026-11-13"))).toBe(
      false,
    );
    expect(panelTimeRange(funnel, { timeRange: "7d" }, december)).toEqual({
      kind: "days",
      start: Date.parse("2026-11-24"),
      end: Date.parse("2026-12-02"),
    });
  });

  it("reads a preset as long as the filter takes, past the chart's gap-fill limit", () => {
    const summer2024 = { startDate: "2024-08-05", endDate: "2024-08-09" };
    expect(listed(summer2024, { timeRange: "900d" })).toBe(true);
    expect(listed(summer2024, { timeRange: "365d" })).toBe(false);
  });

  it("reads a date-range filter's start and end, not from a comment, and no range when the SQL reads two", () => {
    const bySignup = {
      sql: "SELECT plan, count(*) FROM signups WHERE signup_date >= '{{signupStart}}' AND signup_date <= '{{signupEnd}}' GROUP BY plan",
    };
    const vars = { signupStart: "2026-10-13", signupEnd: "2026-10-31" };
    expect(panelTimeRange(bySignup, vars, december)).toEqual({
      kind: "days",
      start: Date.parse("2026-10-13"),
      end: Date.parse("2026-11-01"),
    });
    expect(
      dataNoteInRange(SETUP_INCIDENT, panelTimeRange(bySignup, vars, december)),
    ).toBe(true);
    expect(
      dataNoteInRange(
        SETUP_INCIDENT,
        panelTimeRange(bySignup, { ...vars, signupStart: "2026-10-14" }),
      ),
    ).toBe(false);
    const withSignups = (sql: string) =>
      panelTimeRange({ sql }, { ...vars, timeRange: "90d" }, december);
    expect(
      withSignups(
        funnel.sql.replace(
          " GROUP BY step",
          " AND signup_date >= '{{signupStart}}' AND signup_date <= '{{signupEnd}}' GROUP BY step",
        ),
      ),
    ).toEqual({ kind: "unreadable" });
    expect(
      withSignups(`${funnel.sql}
-- by {{signupStart}} to {{signupEnd}}`),
    ).toEqual(panelTimeRange(funnel, { timeRange: "90d" }, december));
  });

  it("reads timeRange's own start and end when the SQL uses only those", () => {
    const bounded = {
      sql: "SELECT step, count(*) FROM events WHERE event_date >= '{{timeRangeStart}}' AND event_date <= '{{timeRangeEnd}}' GROUP BY step",
    };
    const vars = {
      timeRange: "30d",
      timeRangeStart: "2026-01-05",
      timeRangeEnd: "2026-01-09",
    };
    expect(panelTimeRange(bounded, vars, december)).toEqual({
      kind: "days",
      start: Date.parse("2026-01-05"),
      end: Date.parse("2026-01-10"),
    });
  });

  it("lists a note that overlaps a custom range by a day", () => {
    const custom = (start: string, end: string) => ({
      timeRange: "custom",
      timeRangeStart: start,
      timeRangeEnd: end,
    });
    expect(listed(SETUP_INCIDENT, custom("2026-09-01", "2026-10-09"))).toBe(
      true,
    );
    expect(listed(SETUP_INCIDENT, custom("2026-10-13", "2026-10-31"))).toBe(
      true,
    );
    expect(listed(SETUP_INCIDENT, custom("2026-09-01", "2026-10-08"))).toBe(
      false,
    );
    expect(listed(SETUP_INCIDENT, custom("2026-10-14", "2026-10-31"))).toBe(
      false,
    );
  });

  it("lists every note under all of time", () => {
    const years = Date.parse("2029-06-01T12:00:00Z");
    expect(listed(SKIPS_UNTRACKED, { timeRange: "all" }, years)).toBe(true);
    expect(listed(SETUP_INCIDENT, { timeRange: "" }, years)).toBe(true);
  });

  it("reaches an ongoing note to today and a note without a start back to the first day", () => {
    const ongoing = { startDate: "2026-11-20" };
    expect(listed(ongoing, { timeRange: "7d" })).toBe(true);
    expect(
      listed(ongoing, {
        timeRange: "custom",
        timeRangeStart: "2026-11-01",
        timeRangeEnd: "2026-11-19",
      }),
    ).toBe(false);
    // Sep 17 is in the 90 days before Dec 1, which start Sep 2.
    expect(listed(SKIPS_UNTRACKED, { timeRange: "90d" })).toBe(true);
    expect(listed(SKIPS_UNTRACKED, { timeRange: "30d" })).toBe(false);
  });

  it("keeps ongoing notes and ones that ended in the last 30 days on a chart without a time range", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const noFilter = panelTimeRange(funnel, {}, now);
    const unbound = panelTimeRange(
      { sql: "SELECT step, count(*) FROM events GROUP BY step" },
      { timeRange: "90d" },
      now,
    );
    expect(noFilter).toEqual({ kind: "absent" });
    expect(unbound).toEqual({ kind: "absent" });
    for (const range of [noFilter, unbound]) {
      expect(dataNoteInRange(CONNECT_UNDERCOUNT, range, now)).toBe(true);
      expect(dataNoteInRange(SETUP_INCIDENT, range, now)).toBe(true);
      expect(dataNoteInRange(SKIPS_UNTRACKED, range, now)).toBe(false);
    }
    expect(listed(SETUP_INCIDENT, {})).toBe(false);
  });

  it("falls back to recent notes, apart from a missing range, when the range can't be read", () => {
    const unreadable: Record<string, string>[] = [
      { timeRange: "fortnight" },
      { timeRange: "custom" },
      {
        timeRange: "custom",
        timeRangeStart: "2026-10-31",
        timeRangeEnd: "2026-10-01",
      },
    ];
    for (const vars of unreadable) {
      expect(panelTimeRange(funnel, vars, december)).toEqual({
        kind: "unreadable",
      });
      expect(listed(SETUP_INCIDENT, vars)).toBe(false);
      expect(listed(CONNECT_UNDERCOUNT, vars)).toBe(true);
    }
  });
});

describe("dataNoteTone", () => {
  it("keeps incidents red and greys data problems once fixed", () => {
    expect(dataNoteTone(SETUP_INCIDENT)).toBe("incident");
    expect(dataNoteTone(CONNECT_UNDERCOUNT)).toBe("data");
    expect(dataNoteTone(SKIPS_UNTRACKED)).toBe("fixed");
  });
});

describe("formatDataNoteDates", () => {
  it("says how to read each kind of range", () => {
    expect(formatDataNoteDates(SETUP_INCIDENT, "en-US")).toEqual({
      kind: "range",
      text: expect.stringMatching(/^Oct 9\s–\s13, 2026$/),
    });
    expect(formatDataNoteDates(CONNECT_UNDERCOUNT, "en-US")).toEqual({
      kind: "since",
      text: "Oct 2, 2026",
    });
    expect(formatDataNoteDates(SKIPS_UNTRACKED, "en-US")).toEqual({
      kind: "until",
      text: "Sep 17, 2026",
    });
    expect(formatDataNoteDates({}, "en-US")).toBe(null);
  });
});

describe("hiddenDataNotesIssue", () => {
  it("accepts absent and well-formed lists", () => {
    expect(hiddenDataNotesIssue(undefined)).toBe(null);
    expect(hiddenDataNotesIssue([{ noteId: "n", panelId: "p" }])).toBe(null);
  });

  it("rejects anything but { noteId, panelId } pairs", () => {
    for (const bad of [
      "n",
      [{ noteId: "n" }],
      [{ noteId: "n", panelId: " " }],
      [{ noteId: "n", panelId: "p", extra: true }],
      [null],
    ]) {
      expect(hiddenDataNotesIssue(bad)).toMatch(/hiddenDataNotes must be/);
    }
  });
});
