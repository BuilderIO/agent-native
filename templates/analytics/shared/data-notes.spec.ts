import { describe, expect, it } from "vitest";

import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
  SKIPS_UNTRACKED,
} from "./annotation-fixtures";
import {
  dataNoteAppliesTo,
  dataNoteIsRecent,
  dataNotesForPanel,
  dataNoteTone,
  formatDataNoteDates,
  hiddenDataNotesIssue,
  resolveDataNoteBand,
  sqlCountsEvent,
  xValuesAreDates,
} from "./data-notes";

const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10),
  );

const panel = (id: string, sql: string) => ({ id, sql });

describe("sqlCountsEvent", () => {
  it("matches the event as a quoted string, in either quote and any case", () => {
    expect(
      sqlCountsEvent(
        "where event = 'builder connect clicked'",
        "builder connect clicked",
      ),
    ).toBe(true);
    expect(
      sqlCountsEvent(
        'WHERE event IN ("Builder_Connect_Failed")',
        "builder_connect_failed",
      ),
    ).toBe(true);
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
});

describe("dataNoteAppliesTo", () => {
  it("shows on charts counting the event unless they also count its replacement", () => {
    const old = panel("p1", "where event = 'builder connect clicked'");
    const both = panel(
      "p2",
      "where event in ('builder connect clicked', 'builder_connect_clicked')",
    );
    expect(dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", old)).toBe(true);
    expect(dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", both)).toBe(false);
    expect(
      dataNoteAppliesTo(CONNECT_UNDERCOUNT, "dash", panel("p3", "select 1")),
    ).toBe(false);
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

describe("resolveDataNoteBand", () => {
  it("covers a closed note's days on a daily axis, with both edges", () => {
    expect(resolveDataNoteBand(SETUP_INCIDENT, days("2026-10-01", 14))).toEqual(
      { startIndex: 8, endIndex: 12, startEdge: true, endEdge: true },
    );
  });

  it("runs an ongoing note to the last point without an end edge", () => {
    expect(
      resolveDataNoteBand(CONNECT_UNDERCOUNT, days("2026-09-28", 17)),
    ).toEqual({ startIndex: 4, endIndex: 16, startEdge: true, endEdge: false });
  });

  it("starts a note with no known start at the first point, without a start edge", () => {
    expect(
      resolveDataNoteBand(SKIPS_UNTRACKED, days("2026-09-10", 14)),
    ).toEqual({ startIndex: 0, endIndex: 7, startEdge: false, endEdge: true });
  });

  it("clips a note that started before the chart and hides its start edge", () => {
    expect(resolveDataNoteBand(SETUP_INCIDENT, days("2026-10-11", 7))).toEqual({
      startIndex: 0,
      endIndex: 2,
      startEdge: false,
      endEdge: true,
    });
  });

  it("covers every weekly bucket that overlaps the note", () => {
    const weeks = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
    expect(resolveDataNoteBand(SETUP_INCIDENT, weeks)).toEqual({
      startIndex: 1,
      endIndex: 2,
      startEdge: true,
      endEdge: true,
    });
  });

  it("places nothing outside the chart or on an axis that is not dates", () => {
    expect(resolveDataNoteBand(SETUP_INCIDENT, days("2026-09-01", 7))).toBe(
      null,
    );
    expect(resolveDataNoteBand(SETUP_INCIDENT, ["Signup", "Connect"])).toBe(
      null,
    );
    expect(xValuesAreDates(["Signup"])).toBe(false);
    expect(xValuesAreDates([])).toBe(false);
  });
});

describe("dataNoteIsRecent", () => {
  it("keeps ongoing notes and ones that ended in the last 30 days", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(dataNoteIsRecent(CONNECT_UNDERCOUNT, now)).toBe(true);
    expect(dataNoteIsRecent(SETUP_INCIDENT, now)).toBe(true);
    expect(dataNoteIsRecent(SKIPS_UNTRACKED, now)).toBe(false);
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
