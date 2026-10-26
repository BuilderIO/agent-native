// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { revealsAfterDelete } from "./reveal-after-delete";
import { stampSlideSource } from "./slide-source-map";

const slide = (...children: string[]) =>
  `<div class="fmd-slide">${children.join("")}</div>`;

// The canvas is the stored HTML with stamps, minus the svg the sanitizer drops.
function renderCanvas(stored: string) {
  const { html } = stampSlideSource(stored, "r");
  const canvas = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(".fmd-slide")!;
  for (const svg of canvas.querySelectorAll("svg")) svg.remove();
  return canvas;
}

const rendered = (canvas: Element, name: string) =>
  canvas.querySelector(`[data-n="${name}"]`)!;

describe("revealsAfterDelete", () => {
  it("drops only the reveals on the deleted object and renumbers the rest", () => {
    const stored = slide(
      '<h1 data-n="t">T</h1>',
      '<p data-n="b">B</p>',
      '<p data-n="c">C</p>',
    );
    const result = revealsAfterDelete(
      stored,
      [rendered(renderCanvas(stored), "b")],
      [
        { id: "t", elementIndex: 0, elementPath: [0], type: "fade" },
        { id: "b", elementIndex: 1, elementPath: [1], type: "fade" },
        { id: "c", elementIndex: 2, elementPath: [2], type: "zoom" },
      ],
    );
    expect(result).toEqual([
      { id: "t", elementIndex: 0, elementPath: [0], type: "fade" },
      { id: "c", elementIndex: 1, elementPath: [1], type: "zoom" },
    ]);
  });

  it("counts the svg the canvas drops, because the stored path does", () => {
    const stored = slide(
      "<svg></svg>",
      '<p data-n="b">B</p>',
      '<p data-n="c">C</p>',
    );
    const result = revealsAfterDelete(
      stored,
      [rendered(renderCanvas(stored), "b")],
      [
        { id: "b", elementIndex: 1, elementPath: [1], type: "fade" },
        { id: "c", elementIndex: 2, elementPath: [2], type: "fade" },
      ],
    );
    expect(result).toEqual([
      { id: "c", elementIndex: 1, elementPath: [1], type: "fade" },
    ]);
  });

  it("drops reveals inside a removed container", () => {
    const stored = slide(
      '<div data-n="box"><p>x</p><p>y</p></div>',
      "<h1>T</h1>",
    );
    const result = revealsAfterDelete(
      stored,
      [rendered(renderCanvas(stored), "box")],
      [
        { id: "x", elementIndex: 0, elementPath: [0, 0], type: "fade" },
        { id: "t", elementIndex: 1, elementPath: [1], type: "fade" },
      ],
    );
    expect(result).toEqual([
      { id: "t", elementIndex: 0, elementPath: [0], type: "fade" },
    ]);
  });

  it("turns a legacy elementIndex reveal into a path so it survives the shift", () => {
    const stored = slide(
      '<div class="legacy"><p>A</p><p data-n="b">B</p><p data-n="c">C</p></div>',
    );
    const result = revealsAfterDelete(
      stored,
      [rendered(renderCanvas(stored), "b")],
      [{ id: "c", elementIndex: 2, type: "fade" }],
    );
    expect(result).toEqual([
      { id: "c", elementIndex: 1, elementPath: [0, 1], type: "fade" },
    ]);
  });

  it("keeps a reveal that already fails to resolve unchanged, for the save to refuse", () => {
    const stored = slide('<p data-n="b">B</p>', '<p data-n="c">C</p>');
    const broken = {
      id: "broken",
      elementIndex: 9,
      elementPath: [9],
      type: "fade" as const,
    };
    const result = revealsAfterDelete(
      stored,
      [rendered(renderCanvas(stored), "b")],
      [broken],
    );
    expect(result).toEqual([broken]);
  });
});
