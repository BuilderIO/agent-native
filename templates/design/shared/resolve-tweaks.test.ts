import { describe, expect, it } from "vitest";

import type { TweakDefinition } from "./api";
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
  renderResolvedRootBlock,
} from "./resolve-tweaks";

const tweaks: TweakDefinition[] = [
  {
    id: "theme-accent",
    label: "Accent",
    type: "color-swatch",
    defaultValue: "#0EA5E9",
    cssVar: "--color-accent",
  },
  {
    id: "border-radius",
    label: "Corners",
    type: "slider",
    min: 0,
    max: 24,
    step: 2,
    defaultValue: 12,
    cssVar: "--radius",
  },
  {
    id: "dark-mode",
    label: "Dark Mode",
    type: "toggle",
    defaultValue: true,
    cssVar: "--dark-mode",
  },
  {
    id: "density",
    label: "Density",
    type: "segment",
    defaultValue: "normal",
    cssVar: "--density",
  },
  // No cssVar -> must be skipped.
  { id: "noop", label: "Noop", type: "segment", defaultValue: "x" },
];

describe("resolveTweaksToCssVars", () => {
  it("falls back to defaultValue and applies type rules", () => {
    expect(resolveTweaksToCssVars(tweaks, {})).toEqual({
      "--color-accent": "#0EA5E9",
      "--radius": "12px", // number + radius -> px
      "--dark-mode": "1", // boolean true -> "1"
      "--density": "normal", // string passthrough
    });
  });

  it("honors selections and resolves booleans/numbers", () => {
    expect(
      resolveTweaksToCssVars(tweaks, {
        "theme-accent": "#F97316",
        "border-radius": 4,
        "dark-mode": false,
        density: "compact",
      }),
    ).toEqual({
      "--color-accent": "#F97316",
      "--radius": "4px",
      "--dark-mode": "0",
      "--density": "compact",
    });
  });

  it("includes direct CSS custom-property selections", () => {
    expect(
      resolveTweaksToCssVars(tweaks, {
        "--shadow-glow": "0 0 24px rgba(14, 165, 233, 0.4)",
        "--radius-card": 6,
        "--feature-enabled": false,
        "not-a-css-var": "ignored",
      }),
    ).toEqual({
      "--color-accent": "#0EA5E9",
      "--radius": "12px",
      "--dark-mode": "1",
      "--density": "normal",
      "--shadow-glow": "0 0 24px rgba(14, 165, 233, 0.4)",
      "--radius-card": "6px",
      "--feature-enabled": "0",
    });
  });

  it("lets direct CSS custom-property selections override tweak defaults", () => {
    expect(
      resolveTweaksToCssVars(tweaks, {
        "--color-accent": "#111827",
      })["--color-accent"],
    ).toBe("#111827");
  });

  it("drops unsafe CSS values before they can break out of a declaration", () => {
    expect(isSafeCssTokenValue("red; color: black")).toBe(false);
    expect(isSafeCssTokenValue("red} body { color: black")).toBe(false);
    expect(isSafeCssTokenValue("red/* comment */")).toBe(false);
    expect(isSafeCssTokenValue("<style>body{color:red}</style>")).toBe(false);
    expect(isSafeCssTokenValue("oklch(70% 0.12 240)")).toBe(true);
    expect(isSafeCssVarName("--color-accent")).toBe(true);
    expect(isSafeCssVarName("--color-accent;body")).toBe(false);
    expect(isSafeCssVarName("color-accent")).toBe(false);
    expect(
      resolveTweaksToCssVars(tweaks, {
        "theme-accent": "red; color: black",
        "--shadow-glow": "0 0 24px red; color: black",
        "--safe-shadow": "0 0 24px rgba(14, 165, 233, 0.4)",
      }),
    ).toEqual({
      "--radius": "12px",
      "--dark-mode": "1",
      "--density": "normal",
      "--safe-shadow": "0 0 24px rgba(14, 165, 233, 0.4)",
    });
  });

  it("renders a :root block", () => {
    expect(
      renderResolvedRootBlock({ "--color-accent": "#fff", "--radius": "8px" }),
    ).toBe(":root {\n  --color-accent: #fff;\n  --radius: 8px;\n}");
    expect(renderResolvedRootBlock({})).toBe("");
  });

  it("does not render unsafe CSS declarations", () => {
    expect(
      renderResolvedRootBlock({
        "--color-accent": "#fff",
        "--bad": "red; color: black",
      }),
    ).toBe(":root {\n  --color-accent: #fff;\n}");
  });
});
