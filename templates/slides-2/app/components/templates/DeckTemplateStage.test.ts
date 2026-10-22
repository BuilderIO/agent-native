import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fitTemplateStage } from "./DeckTemplateStage";

describe("template preview stage", () => {
  it("fits wide and tall stages without stretching or cropping the slide", () => {
    expect(fitTemplateStage(1200, 540)).toEqual({ width: 960, height: 540 });
    expect(fitTemplateStage(480, 540)).toEqual({ width: 480, height: 270 });
    expect(fitTemplateStage(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
  it("waits for a measurable stage and centers the fitted frame on both axes", () => {
    expect(fitTemplateStage(0, 540)).toBeNull();
    expect(fitTemplateStage(960, 0)).toBeNull();
    const css = readFileSync("app/global.css", "utf8");
    expect(css).toMatch(/\.deck-template-stage\s*\{[^}]*place-items: center;/);
    expect(css).toContain("width: var(--deck-template-stage-width, 100%)");
    expect(css).toContain("height: var(--deck-template-stage-height, 100%)");
  });
});
