import { describe, expect, it } from "vitest";

import {
  MAX_BRAND_KIT_TOKENS,
  brandKitRoleTokens,
  classifyBrandKitToken,
  describeBrandKitTokenRejections,
  friendlyTokenName,
  groupBrandKitTokens,
  isSafeCssTokenValue,
  isSafeCssVarName,
  normalizeBrandKitTokens,
  parseBrandKitTokensFromCss,
  resolveBrandKitTokens,
} from "./tokens.js";

describe("classifyBrandKitToken", () => {
  it("classifies by css var name", () => {
    expect(classifyBrandKitToken("--cds-interactive-01", "#0F62FE")).toBe(
      "color",
    );
    expect(classifyBrandKitToken("--font-heading", "Mona Sans")).toBe(
      "typography",
    );
    expect(classifyBrandKitToken("--radius-none", "0px")).toBe("radius");
    expect(classifyBrandKitToken("--spacing-05", "1rem")).toBe("spacing");
    expect(
      classifyBrandKitToken("--shadow-sm", "0 1px 2px rgba(0,0,0,.1)"),
    ).toBe("shadow");
    expect(classifyBrandKitToken("--duration-fast", "120ms")).toBe("other");
  });

  it("falls back to sniffing the value when the name is uninformative", () => {
    expect(classifyBrandKitToken("--brand-01", "#0F62FE")).toBe("color");
    expect(classifyBrandKitToken("--brand-02", "oklch(0.7 0.1 240)")).toBe(
      "color",
    );
    expect(classifyBrandKitToken("--brand-03", "crimson")).toBe("color");
  });

  it("does not call a dimension a color just because the name says text", () => {
    expect(classifyBrandKitToken("--text-body-size-medium", "1rem")).toBe(
      "typography",
    );
    expect(classifyBrandKitToken("--text-display-lineHeight", "1.375")).toBe(
      "typography",
    );
    expect(classifyBrandKitToken("--border-width-thin", "2px")).toBe("other");
  });

  it("reads letter-spacing as type metrics, not layout spacing", () => {
    expect(classifyBrandKitToken("--letter-spacing-tight", "-0.01em")).toBe(
      "typography",
    );
  });

  it("still trusts a color-ish name when the value is an unresolved reference", () => {
    expect(classifyBrandKitToken("--color-accent", "var(--blue-60)")).toBe(
      "color",
    );
    expect(classifyBrandKitToken("--bgColor-default", "inherit")).toBe("color");
  });
});

describe("friendlyTokenName", () => {
  it("title-cases a css var", () => {
    expect(friendlyTokenName("--primary-color")).toBe("Primary Color");
    expect(friendlyTokenName("--cds_interactive_01")).toBe(
      "Cds Interactive 01",
    );
  });
});

describe("css safety predicates", () => {
  it("accepts custom property idents only", () => {
    expect(isSafeCssVarName("--cds-interactive-01")).toBe(true);
    expect(isSafeCssVarName("--a_b-9")).toBe(true);
    expect(isSafeCssVarName("interactive-01")).toBe(false);
    expect(isSafeCssVarName("--bad:name")).toBe(false);
    expect(isSafeCssVarName("--bad name")).toBe(false);
  });

  it("accepts ordinary multi-part values", () => {
    expect(isSafeCssTokenValue("0.5rem 1rem")).toBe(true);
    expect(isSafeCssTokenValue('"Mona Sans", sans-serif')).toBe(true);
    expect(isSafeCssTokenValue("0 1px 2px rgba(0, 0, 0, 0.1)")).toBe(true);
  });

  it("rejects declaration and style-tag breakouts", () => {
    expect(isSafeCssTokenValue("red; color: blue")).toBe(false);
    expect(isSafeCssTokenValue("red } body {")).toBe(false);
    expect(isSafeCssTokenValue("</style><script>")).toBe(false);
    expect(isSafeCssTokenValue("red /* comment */")).toBe(false);
    expect(isSafeCssTokenValue("red\u0000")).toBe(false);
    expect(isSafeCssTokenValue("")).toBe(false);
    expect(isSafeCssTokenValue("x".repeat(301))).toBe(false);
  });
});

describe("normalizeBrandKitTokens", () => {
  it("distinguishes absent tokens from an empty vocabulary", () => {
    expect(normalizeBrandKitTokens(undefined)).toEqual({
      tokens: [],
      rejected: [],
    });
    expect(normalizeBrandKitTokens([])).toEqual({ tokens: [], rejected: [] });
  });

  it("reports a non-array as malformed rather than treating it as empty", () => {
    const result = normalizeBrandKitTokens({ "--a": "#fff" });
    expect(result.tokens).toEqual([]);
    expect(result.rejected).toEqual([{ reason: "malformed", label: "tokens" }]);
  });

  it("keeps the source name and classifies a missing type", () => {
    const result = normalizeBrandKitTokens([
      {
        name: "interactive-01",
        cssVar: "--cds-interactive-01",
        value: "#0F62FE",
        group: "Colors/Interactive",
        source: "Carbon v11",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.tokens).toEqual([
      {
        name: "interactive-01",
        cssVar: "--cds-interactive-01",
        value: "#0F62FE",
        type: "color",
        group: "Colors/Interactive",
        source: "Carbon v11",
      },
    ]);
  });

  it("derives a display name when the source supplied none", () => {
    const result = normalizeBrandKitTokens([
      { cssVar: "--brand-accent", value: "#0F62FE" },
    ]);
    expect(result.tokens[0].name).toBe("Brand Accent");
  });

  it("honours an explicitly declared type over the classifier", () => {
    const result = normalizeBrandKitTokens([
      { cssVar: "--text-scale", value: "1.25", type: "other" },
    ]);
    expect(result.tokens[0].type).toBe("other");
  });

  it("ignores an unrecognised declared type", () => {
    const result = normalizeBrandKitTokens([
      { cssVar: "--cds-interactive-01", value: "#0F62FE", type: "gradient" },
    ]);
    expect(result.tokens[0].type).toBe("color");
  });

  it("reports unsafe entries instead of dropping them silently", () => {
    const result = normalizeBrandKitTokens([
      { cssVar: "--ok", value: "#fff" },
      { cssVar: "interactive-01", value: "#0F62FE" },
      { cssVar: "--breakout", value: "red; color: blue" },
      "nope",
    ]);
    expect(result.tokens.map((t) => t.cssVar)).toEqual(["--ok"]);
    expect(result.rejected).toEqual([
      { reason: "unsafe-css-var", label: "interactive-01" },
      { reason: "unsafe-value", label: "--breakout" },
      { reason: "malformed", label: "nope" },
    ]);
  });

  it("lets a later duplicate override an earlier one", () => {
    const result = normalizeBrandKitTokens([
      { cssVar: "--accent", value: "#111111", source: "globals.css" },
      { cssVar: "--accent", value: "#0F62FE", source: "Brand Kit" },
    ]);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      value: "#0F62FE",
      source: "Brand Kit",
    });
  });

  it("reports every token past the cap", () => {
    const input = Array.from({ length: MAX_BRAND_KIT_TOKENS + 3 }, (_, i) => ({
      cssVar: `--token-${i}`,
      value: "#ffffff",
    }));
    const result = normalizeBrandKitTokens(input);
    expect(result.tokens).toHaveLength(MAX_BRAND_KIT_TOKENS);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((r) => r.reason === "over-limit")).toBe(true);
  });
});

describe("describeBrandKitTokenRejections", () => {
  it("summarises the first entries", () => {
    expect(
      describeBrandKitTokenRejections([
        { reason: "unsafe-value", label: "--a" },
        { reason: "malformed", label: "--b" },
      ]),
    ).toBe("--a (unsafe-value), --b (malformed)");
  });
});

describe("parseBrandKitTokensFromCss", () => {
  it("keeps the source system's own token names", () => {
    const tokens = parseBrandKitTokensFromCss(
      `:root {
  --cds-background: #ffffff;
  --cds-interactive-01: #0f62fe;
  --cds-spacing-05: 1rem;
}`,
      "Carbon v11",
    );

    expect(tokens).toEqual([
      {
        name: "cds-background",
        cssVar: "--cds-background",
        value: "#ffffff",
        type: "color",
        source: "Carbon v11",
      },
      {
        name: "cds-interactive-01",
        cssVar: "--cds-interactive-01",
        value: "#0f62fe",
        type: "color",
        source: "Carbon v11",
      },
      {
        name: "cds-spacing-05",
        cssVar: "--cds-spacing-05",
        value: "1rem",
        type: "spacing",
        source: "Carbon v11",
      },
    ]);
  });

  it("reads the last declaration of a repeated property", () => {
    const tokens = parseBrandKitTokensFromCss(
      ":root { --accent: #111; } .dark { --accent: #eee; }",
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].value).toBe("#eee");
  });

  it("handles a declaration that ends at the closing brace", () => {
    const tokens = parseBrandKitTokensFromCss(":root { --accent: #0f62fe }");
    expect(tokens.map((t) => t.value)).toEqual(["#0f62fe"]);
  });

  it("skips declarations it cannot store safely", () => {
    const tokens = parseBrandKitTokensFromCss(
      ":root { --ok: #fff; --bad: url(x) /* c */; }",
    );
    expect(tokens.map((t) => t.cssVar)).toEqual(["--ok"]);
  });

  it("returns nothing for css with no custom properties", () => {
    expect(parseBrandKitTokensFromCss("body { color: red; }")).toEqual([]);
  });
});

describe("resolveBrandKitTokens", () => {
  const stored = {
    name: "interactive-01",
    cssVar: "--cds-interactive-01",
    value: "#0F62FE",
    type: "color" as const,
  };

  it("prefers stored tokens over customCSS", () => {
    const tokens = resolveBrandKitTokens({
      tokens: [stored],
      customCSS: ":root { --other: #fff; }",
    });
    expect(tokens).toEqual([stored]);
  });

  it("falls back to customCSS names when nothing is stored", () => {
    const tokens = resolveBrandKitTokens(
      { customCSS: ":root { --cds-layer-01: #f4f4f4; }" },
      "Brand Kit",
    );
    expect(tokens).toEqual([
      {
        name: "cds-layer-01",
        cssVar: "--cds-layer-01",
        value: "#f4f4f4",
        type: "color",
        source: "Brand Kit",
      },
    ]);
  });

  it("returns nothing for a kit with neither", () => {
    expect(resolveBrandKitTokens({})).toEqual([]);
    expect(resolveBrandKitTokens(null)).toEqual([]);
    expect(resolveBrandKitTokens(undefined)).toEqual([]);
  });
});

describe("groupBrandKitTokens", () => {
  it("keeps source group paths and orders colors first", () => {
    const groups = groupBrandKitTokens([
      { name: "gap", cssVar: "--gap", value: "1rem", type: "spacing" },
      {
        name: "text-primary",
        cssVar: "--text-primary",
        value: "#161616",
        type: "color",
        group: "Colors/Text",
      },
      {
        name: "interactive-01",
        cssVar: "--interactive-01",
        value: "#0F62FE",
        type: "color",
        group: "Colors/Interactive",
      },
      {
        name: "text-secondary",
        cssVar: "--text-secondary",
        value: "#525252",
        type: "color",
        group: "Colors/Text",
      },
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      "Colors/Interactive",
      "Colors/Text",
      "spacing",
    ]);
    expect(groups[1].tokens.map((t) => t.name)).toEqual([
      "text-primary",
      "text-secondary",
    ]);
  });

  it("separates same-named groups that hold different types", () => {
    const groups = groupBrandKitTokens([
      {
        name: "a",
        cssVar: "--a",
        value: "#fff",
        type: "color",
        group: "Brand",
      },
      {
        name: "b",
        cssVar: "--b",
        value: "1rem",
        type: "spacing",
        group: "Brand",
      },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.type)).toEqual(["color", "spacing"]);
  });
});

describe("brandKitRoleTokens", () => {
  it("publishes the seven colour roles plus radius and spacing", () => {
    const tokens = brandKitRoleTokens({
      colors: { primary: "#0F62FE", accent: "#0F62FE", text: "#161616" },
      borders: { radius: "0px" },
      spacing: { elementGap: "16px", pagePadding: "32px" },
    });
    expect(tokens.map((t) => t.cssVar)).toEqual([
      "--color-primary",
      "--color-accent",
      "--color-text",
      "--radius",
      "--spacing-element-gap",
      "--spacing-page-padding",
    ]);
    expect(tokens[0]).toMatchObject({
      name: "Color Primary",
      type: "color",
      source: "Brand Kit",
    });
  });

  it("skips absent roles and unsafe values rather than emitting a broken var", () => {
    expect(brandKitRoleTokens({ colors: { primary: "" } })).toEqual([]);
    expect(
      brandKitRoleTokens({ colors: { primary: "red; color: blue" } }),
    ).toEqual([]);
    expect(brandKitRoleTokens(null)).toEqual([]);
  });
});
