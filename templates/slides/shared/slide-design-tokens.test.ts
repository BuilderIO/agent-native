import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DesignSystemData } from "./api.js";
import {
  SLIDE_DESIGN_TOKEN_FALLBACKS,
  SLIDE_DESIGN_TOKEN_NAMES,
  SLIDE_TOKEN_ALIASES,
  slideDesignSystemCssRootBlock,
  slideDesignSystemCssVariables,
  slideTokenAliasDeclarations,
} from "./slide-design-tokens.js";

const GLOBAL_CSS = readFileSync(
  path.join(process.cwd(), "app/global.css"),
  "utf8",
);

/** The `.fmd-slide` base rule, where the alias bindings live. */
const FMD_SLIDE_RULE = (() => {
  const start = GLOBAL_CSS.indexOf("\n.fmd-slide {");
  const end = GLOBAL_CSS.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error("No .fmd-slide rule in global.css");
  return GLOBAL_CSS.slice(start, end);
})();

const DESIGN_SYSTEM: DesignSystemData = {
  colors: {
    primary: "#111111",
    secondary: "#222222",
    accent: "#ff00aa",
    background: "#030303",
    surface: "#121212",
    text: "#f5f5f5",
    textMuted: "#aaaaaa",
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "700",
    bodyWeight: "400",
    headingSizes: { h1: "46px", h2: "30px", h3: "24px" },
  },
  spacing: { slidePadding: "72px 96px", elementGap: "18px" },
  borders: { radius: "12px", accentWidth: "1px" },
  slideDefaults: { background: "#030303", labelStyle: "uppercase" },
  logos: [],
};

/**
 * Slides that referenced the design system's own token names rendered with
 * `padding: 0`, no element gaps, and headings at body size, because an
 * undefined custom property is invalid at computed-value time rather than a
 * fall-through to the stylesheet. Nothing failed — the deck just came out as
 * text clumped into one band of an empty canvas. These tests are the check
 * that was missing: they fail if a binding is dropped, renamed, or stops
 * matching the value the renderer supplies.
 */
describe("slide design tokens", () => {
  it("binds every authored token name in the .fmd-slide rule", () => {
    for (const [alias, token] of Object.entries(SLIDE_TOKEN_ALIASES)) {
      const expected = `${alias}: var(${token}, ${SLIDE_DESIGN_TOKEN_FALLBACKS[token]});`;
      expect(FMD_SLIDE_RULE, `global.css is missing "${expected}"`).toContain(
        expected,
      );
    }
  });

  it("aliases only tokens the renderer can actually supply", () => {
    for (const token of Object.values(SLIDE_TOKEN_ALIASES)) {
      expect(SLIDE_DESIGN_TOKEN_NAMES).toContain(token);
    }
  });

  it("covers the token names generated slide HTML has used", () => {
    // Observed in real decks; every one of these silently zeroed or dropped
    // its declaration before the bindings existed.
    for (const alias of [
      "--slidePadding",
      "--elementGap",
      "--headingFont",
      "--bodyFont",
      "--headingWeight",
      "--h1",
      "--h2",
      "--h3",
      "--primary",
      "--background",
      "--text",
      "--textMuted",
      "--accent",
      "--surface",
    ]) {
      expect(Object.keys(SLIDE_TOKEN_ALIASES)).toContain(alias);
    }
  });

  it("maps a design system onto every --ds-* variable", () => {
    const variables = slideDesignSystemCssVariables(DESIGN_SYSTEM);
    expect(Object.keys(variables).sort()).toEqual(
      [...SLIDE_DESIGN_TOKEN_NAMES].sort(),
    );
    expect(variables["--ds-slide-padding"]).toBe("72px 96px");
    expect(variables["--ds-element-gap"]).toBe("18px");
    expect(variables["--ds-h2"]).toBe("30px");
    expect(variables["--ds-heading-weight"]).toBe("700");
  });

  it("omits absent tokens so the stylesheet fallback applies", () => {
    const variables = slideDesignSystemCssVariables({
      ...DESIGN_SYSTEM,
      spacing: { slidePadding: "", elementGap: "20px" },
    });
    expect(variables).not.toHaveProperty("--ds-slide-padding");
    expect(variables["--ds-element-gap"]).toBe("20px");
  });

  it("drops token values that would escape a stylesheet", () => {
    const evilPadding = "64px}</" + "style><scr" + "ipt>alert(1)</scr" + "ipt>";
    const variables = slideDesignSystemCssVariables({
      ...DESIGN_SYSTEM,
      spacing: {
        slidePadding: evilPadding,
        elementGap: "20px; background: url(https://evil.example/x)",
      },
      colors: { ...DESIGN_SYSTEM.colors, primary: "@import 'evil.css'" },
    });
    expect(variables).not.toHaveProperty("--ds-slide-padding");
    expect(variables).not.toHaveProperty("--ds-element-gap");
    expect(variables).not.toHaveProperty("--ds-primary");
    expect(variables["--ds-h2"]).toBe("30px");

    const root = slideDesignSystemCssRootBlock({
      ...DESIGN_SYSTEM,
      spacing: { slidePadding: evilPadding, elementGap: "8px" },
    });
    expect(root).not.toContain("scr" + "ipt");
    expect(root).toContain("--ds-element-gap: 8px;");
  });

  it("emits nothing when no design system is linked", () => {
    expect(slideDesignSystemCssVariables(null)).toEqual({});
    expect(slideDesignSystemCssRootBlock(null)).toBe("");
  });

  it("renders a stylesheet block for the standalone export", () => {
    const root = slideDesignSystemCssRootBlock(DESIGN_SYSTEM);
    expect(root).toContain("--ds-slide-padding: 72px 96px;");
    expect(root).toContain("--ds-h2: 30px;");

    const aliases = slideTokenAliasDeclarations();
    expect(aliases).toContain(
      "--slidePadding: var(--ds-slide-padding, 64px 80px);",
    );
    expect(aliases).toContain("--h2: var(--ds-h2, 40px);");
  });
});
