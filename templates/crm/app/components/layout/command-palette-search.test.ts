import { describe, expect, it } from "vitest";

import {
  commandPaletteFilter,
  commandPaletteKeywords,
  rankCommandPaletteEntries,
  uniqueCommandItems,
} from "./command-palette-search";

describe("commandPaletteKeywords", () => {
  it("adds hyphen, space, and compact variants", () => {
    const keywords = commandPaletteKeywords("Acme Corp");

    expect(keywords).toContain("Acme Corp");
    expect(keywords).toContain("Acme-Corp");
    expect(keywords).toContain("acme-corp");
    expect(keywords).toContain("AcmeCorp");
  });

  it("skips empty values", () => {
    expect(commandPaletteKeywords("", undefined, null)).toEqual([]);
  });
});

describe("commandPaletteFilter", () => {
  it("returns 1 for an empty query so every entry stays visible", () => {
    expect(commandPaletteFilter("record:1:Acme", "  ")).toBe(1);
  });

  it("scores an exact word match above a loose subsequence match", () => {
    const exact = commandPaletteFilter(
      "list:hot-leads",
      "leads",
      commandPaletteKeywords("Hot leads", "list"),
    );
    const fuzzy = commandPaletteFilter(
      "record:northline-energy",
      "leads",
      commandPaletteKeywords("Northline Energy", "account"),
    );

    expect(exact).toBeGreaterThan(0.9);
    expect(exact).toBeGreaterThan(fuzzy);
  });

  it("matches accented record names typed without accents", () => {
    expect(
      commandPaletteFilter(
        "record:zoe",
        "zoe",
        commandPaletteKeywords("Zoë Fontaine"),
      ),
    ).toBeGreaterThan(0.8);
  });

  it("does not match a query with no relationship to the candidate", () => {
    expect(
      commandPaletteFilter(
        "command:new-task",
        "zzzz",
        commandPaletteKeywords("New task"),
      ),
    ).toBe(0);
  });
});

describe("rankCommandPaletteEntries", () => {
  it("puts the prefix match first and drops non-matches", () => {
    const ranked = rankCommandPaletteEntries(
      [
        { id: "a", value: "record:acme-holdings", name: "Acme Holdings" },
        { id: "b", value: "list:accounts-to-call", name: "Accounts to call" },
        { id: "c", value: "command:toggle-theme", name: "Toggle theme" },
      ],
      "acme",
      (entry) => ({
        value: entry.value,
        keywords: commandPaletteKeywords(entry.name),
      }),
    );

    expect(ranked.map(({ entry }) => entry.id)).toEqual(["a"]);
  });

  it("keeps input order as the tiebreaker for equal scores", () => {
    const ranked = rankCommandPaletteEntries(
      [
        { id: "first", name: "Renewal review" },
        { id: "second", name: "Renewal review" },
      ],
      "renewal",
      (entry) => ({
        value: `view:${entry.id}`,
        keywords: commandPaletteKeywords(entry.name),
      }),
    );

    expect(ranked.map(({ entry }) => entry.id)).toEqual(["first", "second"]);
  });
});

describe("uniqueCommandItems", () => {
  it("keeps the first row for a repeated id", () => {
    expect(
      uniqueCommandItems([
        { id: "1", name: "Acme" },
        { id: "1", name: "Acme (duplicate)" },
        { id: "2", name: "Northline" },
      ]).map((item) => item.name),
    ).toEqual(["Acme", "Northline"]);
  });
});
