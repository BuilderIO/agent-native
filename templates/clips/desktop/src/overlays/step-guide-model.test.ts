import { describe, expect, it } from "vitest";

import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  moveItem,
  setZoom,
  stepNumbers,
  visibleRect,
  type GuideImage,
  type GuideItem,
} from "./step-guide-model";

function image(overrides: Partial<GuideImage> = {}): GuideImage {
  return {
    fileName: "step-001.png",
    width: 3024,
    height: 1964,
    crop: { x: 0, y: 0, width: 3024, height: 1964 },
    click: { x: 1512, y: 982 },
    zoom: 2,
    ...overrides,
  };
}

describe("visibleRect", () => {
  it("keeps the frame aspect and centres on the click", () => {
    const rect = visibleRect(image());
    expect(rect.width / rect.height).toBeCloseTo(FRAME_WIDTH / FRAME_HEIGHT);
    expect(rect.x + rect.width / 2).toBeCloseTo(1512);
    expect(rect.y + rect.height / 2).toBeCloseTo(982);
  });

  it("never zooms closer than 1000 px wide", () => {
    expect(visibleRect(image({ zoom: 4 })).width).toBe(1000);
  });

  it("clamps the frame inside the crop near an edge", () => {
    const rect = visibleRect(image({ click: { x: 10, y: 10 } }));
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it("shows the whole crop height at zoom 1 for a wide crop", () => {
    const rect = visibleRect(
      image({ zoom: 1, crop: { x: 0, y: 0, width: 3024, height: 1000 } }),
    );
    expect(rect.height).toBeCloseTo(1000);
  });
});

describe("guide items", () => {
  const items: GuideItem[] = [
    { kind: "step", id: "a", text: "A", image: null },
    { kind: "note", id: "n", text: "Note" },
    { kind: "step", id: "b", text: "B", image: image() },
  ];

  it("numbers steps without counting notes", () => {
    const numbers = stepNumbers(items);
    expect(numbers.get("a")).toBe(1);
    expect(numbers.get("b")).toBe(2);
    expect(numbers.has("n")).toBe(false);
  });

  it("moves items and ignores moves past either end", () => {
    expect(moveItem(items, 2, -1).map((item) => item.id)).toEqual([
      "a",
      "b",
      "n",
    ]);
    expect(moveItem(items, 0, -1)).toBe(items);
  });

  it("clamps zoom", () => {
    const zoomed = setZoom(items[2], 9);
    expect(zoomed.kind === "step" && zoomed.image?.zoom).toBe(4);
  });
});
