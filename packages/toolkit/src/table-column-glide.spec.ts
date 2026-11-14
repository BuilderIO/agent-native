// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTableColumnGlide,
  markTableProseCells,
} from "./table-column-glide.js";

/** A two-row table whose column starts the test controls. */
function table(starts: number[]) {
  const element = document.createElement("table");
  const animations: { column: number; keyframes: Keyframe[] }[] = [];
  for (let row = 0; row < 2; row += 1) {
    const tr = element.insertRow();
    starts.forEach((_, column) => {
      const cell = tr.insertCell();
      Object.defineProperty(cell, "offsetLeft", {
        get: () => starts[column],
      });
      cell.animate = ((keyframes: Keyframe[]) => {
        animations.push({ column, keyframes });
        return {} as Animation;
      }) as typeof cell.animate;
    });
  }
  return { element, animations };
}

describe("createTableColumnGlide", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("slides every cell of a moved column from where it was", () => {
    const starts = [0, 120, 300];
    const { element, animations } = table(starts);
    const glide = createTableColumnGlide();
    glide(element);
    expect(animations).toHaveLength(0);

    // The first column's cell grew by 40px, pushing the other two right.
    starts[1] = 160;
    starts[2] = 340;
    glide(element);

    expect(animations.map((animation) => animation.column)).toEqual([
      1, 1, 2, 2,
    ]);
    expect(animations[0]!.keyframes[0]).toEqual({
      transform: "translateX(-40px)",
    });
    expect(animations[0]!.keyframes[1]).toEqual({
      transform: "translateX(0)",
    });
  });

  it("leaves columns that did not move alone", () => {
    const starts = [0, 120];
    const { element, animations } = table(starts);
    const glide = createTableColumnGlide();
    glide(element);
    glide(element);

    expect(animations).toHaveLength(0);
  });

  it("jumps instead of gliding when motion is reduced", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    const starts = [0, 120];
    const { element, animations } = table(starts);
    const glide = createTableColumnGlide();
    glide(element);
    starts[1] = 200;
    glide(element);

    expect(animations).toHaveLength(0);
  });
});

describe("markTableProseCells", () => {
  it("marks prose cells and clears the mark when a cell no longer holds prose", () => {
    const element = document.createElement("table");
    const row = element.insertRow();
    const label = row.insertCell();
    const prose = row.insertCell();
    label.textContent = "Oct 24";
    prose.textContent = "Runs nightly and keeps the last seven backups.";

    markTableProseCells(element);
    expect(label.hasAttribute("data-prose")).toBe(false);
    expect(prose.hasAttribute("data-prose")).toBe(true);

    prose.textContent = "Nightly";
    markTableProseCells(element);
    expect(prose.hasAttribute("data-prose")).toBe(false);
  });
});
