import { describe, expect, it } from "vitest";

import { parseDtcgFiles } from "./dtcg-tokens.js";

/** Parses one file and drops `source`, which every test here shares. */
function parseDtcgTokens(content: string) {
  const { tokens, dtcgFiles } = parseDtcgFiles([
    { filename: "tokens.json", content },
  ]);
  return dtcgFiles.size > 0
    ? tokens.map(({ source: _, ...token }) => token)
    : null;
}

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
      {
        cssVar: "--accent",
        value: "var(--base-blue)",
        type: "color",
        references: ["--base-blue"],
      },
    ]);
  });

  it("types Tailwind-style text-* dimensions as font sizes", () => {
    expect(
      parseDtcgTokens(
        JSON.stringify({
          text: { lg: { $type: "dimension", $value: "1.125rem" } },
          border: { width: { $type: "dimension", $value: "1px" } },
        }),
      ),
    ).toEqual([
      { cssVar: "--text-lg", value: "1.125rem", type: "font-size" },
      { cssVar: "--border-width", value: "1px", type: "spacing" },
    ]);
  });

  it("counts declarations it could not import", () => {
    const { tokens, skippedCount } = parseDtcgFiles([
      {
        filename: "tokens.json",
        content: JSON.stringify({
          brand: { $type: "color", $value: "#2563eb" },
          fade: {
            $type: "gradient",
            $value: [{ color: "#000", position: 0 }],
          },
          line: { $type: "color", $value: "{fade}" },
          heading: {
            $type: "typography",
            $value: { fontFamily: "Inter", fontSize: "24px" },
          },
        }),
      },
    ]);

    expect(tokens.map((token) => token.cssVar)).toEqual([
      "--brand",
      "--heading-font-family",
      "--heading-font-size",
    ]);
    expect(skippedCount).toBe(2);
  });

  it("drops tokens that reference a token which was left out", () => {
    const tokens = parseDtcgTokens(
      JSON.stringify({
        border: {
          base: {
            $type: "border",
            $value: { color: "#000", width: "1px", style: "solid" },
          },
        },
        line: { $type: "color", $value: "{border.base}" },
        chained: { $type: "color", $value: "{line}" },
        brand: { $type: "color", $value: "#2563eb" },
        accent: { $type: "color", $value: "{brand}" },
      }),
    );

    expect(tokens).toEqual([
      { cssVar: "--brand", value: "#2563eb", type: "color" },
      {
        cssVar: "--accent",
        value: "var(--brand)",
        type: "color",
        references: ["--brand"],
      },
    ]);
  });

  it("resolves references to tokens declared in another file", () => {
    const { tokens, dtcgFiles } = parseDtcgFiles([
      {
        filename: "primitives.json",
        content: JSON.stringify({
          blue: { 500: { $type: "color", $value: "#2563eb" } },
        }),
      },
      {
        filename: "semantic.json",
        content: JSON.stringify({
          accent: { $type: "color", $value: "{blue.500}" },
        }),
      },
      { filename: "theme.css", content: ":root { --a: 1px; }" },
    ]);

    expect([...dtcgFiles]).toEqual(["primitives.json", "semantic.json"]);
    expect(tokens).toEqual([
      {
        cssVar: "--blue-500",
        source: "primitives.json",
        value: "#2563eb",
        type: "color",
      },
      {
        cssVar: "--accent",
        source: "semantic.json",
        value: "var(--blue-500)",
        type: "color",
        references: ["--blue-500"],
      },
    ]);
  });

  it("keeps a string font stack as written and quotes array names", () => {
    const tokens = parseDtcgTokens(
      JSON.stringify({
        font: {
          $type: "fontFamily",
          stack: { $value: "Inter, sans-serif" },
          list: { $value: ["Inter Variable", "sans-serif"] },
        },
      }),
    );

    expect(tokens).toEqual([
      {
        cssVar: "--font-stack",
        value: "Inter, sans-serif",
        type: "font-family",
      },
      {
        cssVar: "--font-list",
        value: '"Inter Variable", sans-serif',
        type: "font-family",
      },
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
