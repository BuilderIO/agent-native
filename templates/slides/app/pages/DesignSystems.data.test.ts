import { describe, expect, it } from "vitest";

import { parseDesignSystemListData } from "./DesignSystems.js";

describe("parseDesignSystemListData", () => {
  // Design systems written before create/update validation existed can have
  // `colors: {}` or be missing whole sections. This page used to hide any
  // such row from the grid entirely — no card, no Delete menu item, no way
  // to remove it from the UI at all. It must always return a renderable
  // DesignSystemData instead of a falsy value.
  it("fills in missing color and typography fields instead of signaling absence", () => {
    const result = parseDesignSystemListData(JSON.stringify({ colors: {} }));

    expect(result).toBeTruthy();
    expect(result.colors.primary).toBeTruthy();
    expect(result.colors.background).toBeTruthy();
    expect(result.typography.headingFont).toBeTruthy();
    expect(result.typography.bodyFont).toBeTruthy();
  });

  it("falls back to full defaults for corrupt, non-JSON stored data", () => {
    const result = parseDesignSystemListData("not json");

    expect(result).toBeTruthy();
    expect(result.colors.primary).toBeTruthy();
    expect(result.typography.headingFont).toBeTruthy();
  });

  it("preserves fields a fully-formed design system already has", () => {
    const stored = {
      colors: {
        primary: "#123456",
        secondary: "#654321",
        accent: "#abcdef",
        background: "#ffffff",
        surface: "#f0f0f0",
        text: "#000000",
        textMuted: "#888888",
      },
      typography: {
        headingFont: "Custom Heading",
        bodyFont: "Custom Body",
        headingWeight: "700",
        bodyWeight: "400",
        headingSizes: { h1: "48px", h2: "32px", h3: "24px" },
      },
    };

    const result = parseDesignSystemListData(JSON.stringify(stored));

    expect(result.colors.primary).toBe("#123456");
    expect(result.typography.headingFont).toBe("Custom Heading");
  });
});
