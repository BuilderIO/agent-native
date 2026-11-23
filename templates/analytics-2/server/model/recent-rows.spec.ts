import { describe, expect, it } from "vitest";

import { collapseRecentRows, type RecentRow } from "./recent-rows.js";

const row = (
  id: string,
  title: string,
  timestamp: string,
  kind: RecentRow["kind"] = "thread",
): RecentRow => ({ id, title, kind, href: `/x/${id}`, timestamp });

describe("collapseRecentRows", () => {
  // oracle-change: resource IDs distinguish conversations even when titles match.
  it("report 182 keeps distinct same-title conversations and collapses repeated IDs", () => {
    const older = row(
      "t1",
      "Run Signup Funnel SQL",
      "2026-11-11T10:00:00.000Z",
    );
    const other = row(
      "t2",
      "Run Signup Funnel SQL",
      "2026-11-11T10:05:00.000Z",
    );
    const newer = row("t1", "Renamed", "2026-11-11T10:09:00.000Z");
    expect(collapseRecentRows([older, other, newer]).map((r) => r.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(collapseRecentRows([older, newer]).map((r) => r.title)).toEqual([
      "Renamed",
    ]);
  });

  it("keeps the newest row and its place in the ordering", () => {
    const rows = [
      row("thread", "Revenue by Region Chart", "2026-11-11T09:00:00.000Z"),
      row("p1", "Signup funnel", "2026-11-11T09:30:00.000Z", "project"),
      row("thread", "Revenue by Region Chart", "2026-11-11T10:30:00.000Z"),
    ];
    expect(collapseRecentRows(rows).map((r) => r.id)).toEqual(["thread", "p1"]);
  });

  it("never merges different kinds that share an ID", () => {
    const rows = [
      row("1", "Signup funnel", "2026-11-11T09:00:00.000Z", "project"),
      row("1", "Signup funnel", "2026-11-11T10:00:00.000Z", "thread"),
    ];
    expect(collapseRecentRows(rows).map((r) => r.kind)).toEqual([
      "thread",
      "project",
    ]);
  });

  it("A2-RECENTS-DISTINCT-SAME-TITLE retains distinct projects but collapses repeated IDs", () => {
    const older = row("p1", "Revenue", "2026-11-11T09:00:00.000Z", "project");
    const other = row("p2", "Revenue", "2026-11-11T10:00:00.000Z", "project");
    const newer = row("p1", "Renamed", "2026-11-11T11:00:00.000Z", "project");
    expect(collapseRecentRows([older, other]).map((r) => r.id)).toEqual([
      "p2",
      "p1",
    ]);
    expect(collapseRecentRows([older, newer]).map((r) => r.id)).toEqual(["p1"]);
  });
});
