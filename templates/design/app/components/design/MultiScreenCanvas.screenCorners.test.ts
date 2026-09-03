import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./MultiScreenCanvas.tsx", import.meta.url),
  "utf8",
);

/** A screen is a rectangle. Rounding its selection chrome implied a device. */
describe("screen selection chrome", () => {
  it.each([
    ["data-passive-frame-selection-box", "PassiveSelectionBox"],
    ["data-frame-selection-box", "SelectionBox"],
  ])("draws %s with square corners", (_marker, componentName) => {
    const start = source.indexOf(`function ${componentName}(`);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 2000);
    expect(body).not.toContain("borderRadius: 13");
  });

  it("keeps no hardcoded chrome radius anywhere in the canvas", () => {
    expect(source).not.toContain("borderRadius: 13 * chromeScale");
  });
});
