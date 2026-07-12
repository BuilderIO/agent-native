import { describe, expect, it } from "vitest";

import {
  commandPaletteFilter,
  commandPaletteKeywords,
  uniqueCommandItems,
} from "./command-palette-search";

describe("commandPaletteKeywords", () => {
  it("adds hyphen and space variants for resource names", () => {
    const keywords = commandPaletteKeywords("Agent Native");

    expect(keywords).toContain("Agent Native");
    expect(keywords).toContain("Agent-Native");
    expect(keywords).toContain("agent-native");
    expect(keywords).toContain("AgentNative");
  });

  it("adds space variants for hyphenated extension names", () => {
    const keywords = commandPaletteKeywords("Agent-Native stars");

    expect(keywords).toContain("Agent Native stars");
    expect(keywords).toContain("agent native stars");
    expect(keywords).toContain("Agent-Native-stars");
  });

  it("skips empty values", () => {
    expect(commandPaletteKeywords("", undefined, null)).toEqual([]);
  });
});

describe("commandPaletteFilter", () => {
  it("ranks exact and prefix matches above loose fuzzy matches", () => {
    const themeScore = commandPaletteFilter(
      "appearance:theme",
      "light",
      commandPaletteKeywords("Toggle light mode", "theme", "light mode"),
    );
    const dashboardScore = commandPaletteFilter(
      "sql:clara-wright",
      "light",
      commandPaletteKeywords("Clara Wright", "dashboard"),
    );

    expect(themeScore).toBeGreaterThan(0.9);
    expect(themeScore).toBeGreaterThan(dashboardScore);
  });

  it("ranks an exact theme command above settings that only fuzzy-match light", () => {
    const themeScore = commandPaletteFilter(
      "appearance:theme:Toggle light mode",
      "light",
      commandPaletteKeywords("Toggle light mode", "theme", "light"),
    );
    const browserScore = commandPaletteFilter(
      "setting:section:browser:Browser Automation",
      "light",
      commandPaletteKeywords(
        "Browser Automation",
        "web scraping playwright chrome headless Workspace settings",
        "settings",
      ),
    );
    const authenticationScore = commandPaletteFilter(
      "setting:section:auth:Authentication",
      "light",
      commandPaletteKeywords(
        "Authentication",
        "login signup oauth google github access sso Workspace settings",
        "settings",
      ),
    );

    expect(themeScore).toBe(1);
    expect(themeScore).toBeGreaterThan(browserScore);
    expect(themeScore).toBeGreaterThan(authenticationScore);
  });

  it("keeps typo-friendly subsequence matches below direct matches", () => {
    expect(
      commandPaletteFilter("tool:explorer", "explr", ["Explorer"]),
    ).toBeGreaterThan(0);
    expect(commandPaletteFilter("tool:admin", "explr", ["Admin"])).toBe(0);
  });
});

describe("uniqueCommandItems", () => {
  it("keeps distinct ids even when resources have the same display name", () => {
    expect(
      uniqueCommandItems([
        { id: "demo", name: "Demo Node Exporter Full" },
        { id: "demo-copy", name: "  demo node exporter full  " },
        { id: "billing", name: "On Demand Billing" },
        { id: "billing", name: "Renamed duplicate id" },
      ]),
    ).toEqual([
      { id: "demo", name: "Demo Node Exporter Full" },
      { id: "demo-copy", name: "  demo node exporter full  " },
      { id: "billing", name: "On Demand Billing" },
    ]);
  });
});
