import { describe, expect, it } from "vitest";

import {
  matchProjectsByTitle,
  normalizeProjectTitle,
  pickProjectByQuestion,
} from "./project-title-match.js";

const projects = [
  { id: "prj_orders", title: "Orders by month — demo data" },
  { id: "prj_rev", title: "Revenue" },
  { id: "prj_rev_q", title: "Revenue (Q4)" },
  { id: "prj_symbols", title: "***" },
];
const ids = (name: string) =>
  matchProjectsByTitle(projects, name).map((project) => project.id);

describe("matchProjectsByTitle", () => {
  it("matches the title however the dash is typed and without the title's tail", () => {
    expect(ids("Orders by month - demo")).toEqual(["prj_orders"]);
    expect(ids("orders by month – demo data")).toEqual(["prj_orders"]);
    expect(ids("Orders by month demo")).toEqual(["prj_orders"]);
    expect(ids("  ORDERS   by month ")).toEqual(["prj_orders"]);
  });

  it("matches title words in any order when no title contains the phrase", () => {
    expect(ids("demo data orders")).toEqual(["prj_orders"]);
  });

  it("prefers an exact title over a longer one that contains it", () => {
    expect(ids("revenue")).toEqual(["prj_rev"]);
    expect(ids("Revenue Q4")).toEqual(["prj_rev_q"]);
  });

  it("returns every match when the name is ambiguous, and none for an unknown name", () => {
    expect(ids("rev")).toEqual(["prj_rev", "prj_rev_q"]);
    expect(ids("No such project")).toEqual([]);
  });

  it("does not match every project for a name made only of symbols", () => {
    expect(ids("***")).toEqual(["prj_symbols"]);
    expect(ids("!!!")).toEqual([]);
  });

  it("normalizes case, accents, dashes and spacing", () => {
    expect(normalizeProjectTitle("Café — Orders")).toBe("cafe orders");
  });
});

describe("pickProjectByQuestion", () => {
  const v3 = [
    { id: "prj_v3", title: "Agent-Native - BigQuery v3" },
    { id: "prj_other", title: "Checkout funnel v3" },
  ];
  it("keeps a single match as is", () => {
    expect(pickProjectByQuestion([v3[0]!], "anything")?.id).toBe("prj_v3");
  });
  it("breaks a tie by the title words the whole question repeats", () => {
    expect(
      pickProjectByQuestion(
        v3,
        "How's my Agent-Native metrics doing in my V3 dashboard?",
      )?.id,
    ).toBe("prj_v3");
  });
  it("gives up when the question does not separate the matches", () => {
    expect(
      pickProjectByQuestion(v3, "How's my V3 dashboard doing?"),
    ).toBeUndefined();
  });
});
