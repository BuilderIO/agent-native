import data from "emojibase-data/en/data.json";
import { describe, expect, it } from "vitest";

import { EMOJI_CATEGORIES, loadEmojiCatalog } from "./emoji-catalog.js";

describe("emoji catalog", () => {
  it("loads the maintained dataset with joined and skin-tone sequences", async () => {
    const catalog = await loadEmojiCatalog();
    expect(catalog.length).toBeGreaterThan(1_000);
    expect(catalog.some((entry) => entry.emoji.includes("\u200d"))).toBe(true);
    expect(
      catalog.some((entry) => /[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji)),
    ).toBe(true);
  });

  it("browses the complete Unicode catalog in group order without standalone components", async () => {
    const catalog = await loadEmojiCatalog();
    const expected = data
      .filter(
        (entry) =>
          entry.group !== undefined &&
          entry.group !== 2 &&
          entry.order !== undefined,
      )
      .flatMap((entry) => [entry, ...(entry.skins ?? [])])
      .map((entry) => entry.emoji);
    expect(catalog.map((entry) => entry.emoji).sort()).toEqual(expected.sort());
    expect(catalog[0].emoji).toBe("😀");
    expect(catalog.some((entry) => entry.emoji === "🇦")).toBe(false);
    expect(catalog.some((entry) => entry.emoji === "🏻")).toBe(false);
    expect(
      catalog.some(
        (entry) => entry.emoji === "🇿🇼" && entry.category === "flags",
      ),
    ).toBe(true);
    expect(
      catalog.some((entry) => entry.emoji === "👋🏽" && entry.skinTone === 3),
    ).toBe(true);
    expect(catalog.map((entry) => entry.order)).toEqual(
      catalog.map((entry) => entry.order).sort((a, b) => a - b),
    );
    expect(new Set(catalog.map((entry) => entry.category))).toEqual(
      new Set(EMOJI_CATEGORIES),
    );
  });
});
