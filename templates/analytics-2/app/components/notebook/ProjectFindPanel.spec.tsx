import { describe, expect, it } from "vitest";

import { findCellMatches } from "./ProjectFindPanel";

const cells = [
  { id: "c1", label: "Load orders", kind: "sql", text: "select * from orders" },
  { id: "c2", label: "Revenue", kind: "display-table", text: "" },
  {
    id: "c3",
    label: "Notes",
    kind: "markdown",
    text: "orders are reconciled nightly",
  },
];

describe("findCellMatches", () => {
  it("matches a cell's text and its label, case-insensitively", () => {
    expect(
      findCellMatches(cells, "ORDERS").map((match) => match.cellId),
    ).toEqual(["c1", "c3"]);
    expect(
      findCellMatches(cells, "Revenue").map((match) => match.cellId),
    ).toEqual(["c2"]);
  });

  it("returns nothing for an empty query", () => {
    expect(findCellMatches(cells, "   ")).toEqual([]);
  });

  it("keeps the line around the first match as the snippet", () => {
    expect(findCellMatches(cells, "reconciled")[0]?.snippet).toBe(
      "orders are reconciled nightly",
    );
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
