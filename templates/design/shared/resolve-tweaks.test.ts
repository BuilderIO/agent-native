import { describe, expect, it } from "vitest";

import type { TweakDefinition } from "./api";
import {
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

  it("renders a :root block", () => {
    expect(
      renderResolvedRootBlock({ "--color-accent": "#fff", "--radius": "8px" }),
    ).toBe(":root {\n  --color-accent: #fff;\n  --radius: 8px;\n}");
    expect(renderResolvedRootBlock({})).toBe("");
  });
});
