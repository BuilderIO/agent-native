import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A screen is a page. Rounding its card implies a corner radius the exported
 * document does not have, and the breakpoint frame mirrors the same chrome.
 */
const source = readFileSync(
  new URL("./MultiScreenCanvas.tsx", import.meta.url),
  "utf8",
);

describe("screen card corners", () => {
  it("renders every artboard square", () => {
    const artboards = source
      .split("\n")
      .filter((line) => line.includes("group/artboard relative block"));
    expect(artboards.length).toBeGreaterThanOrEqual(2);
    for (const line of artboards) {
      expect(line).not.toMatch(/\brounded(-|")/);
    }
  });
});
