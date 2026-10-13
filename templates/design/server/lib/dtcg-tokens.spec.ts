import { describe, expect, it } from "vitest";

import { parseDtcgTokens } from "./dtcg-tokens.js";

describe("parseDtcgTokens", () => {
  it("returns null for content that is not a DTCG file", () => {
    expect(parseDtcgTokens(":root { --a: 1px; }")).toBeNull();
    expect(
      parseDtcgTokens(JSON.stringify({ colors: { primary: "#000" } })),
    ).toBeNull();
  });

  it("maps $type to token types, inheriting $type from groups", () => {
    const tokens = parseDtcgTokens(
      JSON.stringify({
        color: {
          $type: "color",
          brand: { primary: { $value: "#2563eb" } },
        },
        space: {
          md: { $type: "dimension", $value: { value: 16, unit: "px" } },
        },
        radius: { lg: { $type: "dimension", $value: "12px" } },
        font: {
          body: {
            $type: "fontFamily",
            $value: ["Inter Variable", "sans-serif"],
          },
          bold: { $type: "fontWeight", $value: 700 },
        },
        opacity: { muted: { $type: "number", $value: 0.6 } },
        duration: { fast: { $type: "duration", $value: "120ms" } },
      }),
    );

    expect(tokens).toEqual([
      { cssVar: "--color-brand-primary", value: "#2563eb", type: "color" },
      { cssVar: "--space-md", value: "16px", type: "spacing" },
      { cssVar: "--radius-lg", value: "12px", type: "radius" },
      {
        cssVar: "--font-body",
        value: '"Inter Variable", sans-serif',
        type: "font-family",
      },
      { cssVar: "--font-bold", value: "700", type: "font-weight" },
      { cssVar: "--opacity-muted", value: "0.6", type: "opacity" },
      { cssVar: "--duration-fast", value: "120ms", type: "motion" },
    ]);
  });

  it("turns references into var() and drops unresolvable ones", () => {
    const tokens = parseDtcgTokens(
      JSON.stringify({
        base: { blue: { $type: "color", $value: "#2563eb" } },
        accent: { $type: "color", $value: "{base.blue}" },
        missing: { $type: "color", $value: "{base.red}" },
      }),
    );

    expect(tokens).toEqual([
      { cssVar: "--base-blue", value: "#2563eb", type: "color" },
      { cssVar: "--accent", value: "var(--base-blue)", type: "color" },
    ]);
  });

  it("formats shadows and expands typography composites", () => {
    const tokens = parseDtcgTokens(
      JSON.stringify({
        shadow: {
          card: {
            $type: "shadow",
            $value: {
              color: "#00000033",
              offsetX: "0px",
              offsetY: "1px",
              blur: "2px",
              spread: "0px",
            },
          },
        },
        type: {
          heading: {
            $type: "typography",
            $value: {
              fontFamily: "Inter",
              fontWeight: 600,
              fontSize: "24px",
              lineHeight: 1.2,
            },
          },
        },
      }),
    );

    expect(tokens).toEqual([
      {
        cssVar: "--shadow-card",
        value: "0px 1px 2px 0px #00000033",
        type: "shadow",
      },
      {
        cssVar: "--type-heading-font-family",
        value: "Inter",
        type: "font-family",
      },
      {
        cssVar: "--type-heading-font-weight",
        value: "600",
        type: "font-weight",
      },
      { cssVar: "--type-heading-font-size", value: "24px", type: "font-size" },
      {
        cssVar: "--type-heading-line-height",
        value: "1.2",
        type: "line-height",
      },
    ]);
  });
});
