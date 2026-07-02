import { describe, expect, it } from "vitest";

import { commandPaletteKeywords } from "./command-palette-search";

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
