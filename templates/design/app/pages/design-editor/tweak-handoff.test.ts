import { describe, expect, it } from "vitest";

import {
  formatTweakHandoffPrompt,
  getTweakHandoffChanges,
} from "./tweak-handoff";

const tweaks = [
  {
    id: "hero-gap",
    label: "Hero gap",
    type: "range",
    defaultValue: 24,
    cssVar: "--hero-gap",
  },
] as never[];

describe("remix tweak handoff", () => {
  it("reports old and new values and the target CSS variable", () => {
    const changes = getTweakHandoffChanges({
      tweaks,
      before: { "hero-gap": 24 },
      after: { "hero-gap": 40 },
    });
    expect(changes).toEqual([
      {
        id: "hero-gap",
        label: "Hero gap",
        oldValue: 24,
        newValue: 40,
        cssVar: "--hero-gap",
      },
    ]);
    expect(
      formatTweakHandoffPrompt({
        designId: "design-1",
        changes,
        sourceFiles: ["src/hero.tsx"],
      }),
    ).toContain("CSS variable: `--hero-gap`");
    expect(
      formatTweakHandoffPrompt({
        designId: "design-1",
        changes,
        sourceFiles: ["src/hero.tsx"],
      }),
    ).toContain("src/hero.tsx");
  });

  it("does not offer a handoff when values match the loaded baseline", () => {
    expect(
      getTweakHandoffChanges({
        tweaks,
        before: { "hero-gap": 24 },
        after: { "hero-gap": 24 },
      }),
    ).toEqual([]);
  });

  it("includes direct CSS variable selections in the handoff delta", () => {
    expect(
      getTweakHandoffChanges({
        tweaks: [],
        before: { "--brand-color": "red" },
        after: { "--brand-color": "blue" },
      }),
    ).toEqual([
      {
        id: "--brand-color",
        label: "--brand-color",
        oldValue: "red",
        newValue: "blue",
        cssVar: "--brand-color",
      },
    ]);
  });

  it("includes a direct CSS variable change when its source baseline is unknown", () => {
    expect(
      getTweakHandoffChanges({
        tweaks: [],
        before: {},
        after: { "--brand-color": "blue" },
      }),
    ).toEqual([
      {
        id: "--brand-color",
        label: "--brand-color",
        oldValue: "(source default)",
        newValue: "blue",
        cssVar: "--brand-color",
      },
    ]);
  });
});
