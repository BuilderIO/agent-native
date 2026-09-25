import { describe, expect, it } from "vitest";

import {
  parseIconValue,
  safeParseIconValue,
  serializeIconValue,
} from "./index.js";

describe("IconValue", () => {
  it("round-trips each versioned icon kind", () => {
    const values = [
      { version: 1, kind: "emoji", emoji: "👩🏽‍💻" },
      {
        version: 1,
        kind: "library",
        library: "tabler",
        name: "book-2",
        variant: "outline",
        color: "blue",
      },
      {
        version: 1,
        kind: "image",
        assetId: "asset_123",
        authority: "workspace:example",
        alt: "Team logo",
      },
    ] as const;

    for (const value of values) {
      expect(parseIconValue(serializeIconValue(value))).toEqual(value);
    }
  });

  it("upgrades legacy strings without splitting emoji graphemes", () => {
    expect(parseIconValue("👨‍👩‍👧‍👦")).toEqual({
      version: 1,
      kind: "emoji",
      emoji: "👨‍👩‍👧‍👦",
    });
  });

  it("preserves explicit null and rejects malformed serialized values", () => {
    expect(parseIconValue(null)).toBeNull();
    expect(safeParseIconValue('{"version":1,"kind":"library"}').success).toBe(
      false,
    );
    expect(() => parseIconValue("{")).toThrow();
  });

  it("rejects raw colors and unknown fields", () => {
    expect(
      safeParseIconValue({
        version: 1,
        kind: "library",
        library: "tabler",
        name: "book",
        color: "#00f",
      }).success,
    ).toBe(false);
    expect(
      safeParseIconValue({
        version: 1,
        kind: "image",
        assetId: "asset_123",
        authority: "workspace:example",
        url: "https://example.invalid/icon.png",
      }).success,
    ).toBe(false);
  });
});
