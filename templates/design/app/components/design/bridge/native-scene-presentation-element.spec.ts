// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";

import { isNativeScenePresentationElement } from "./native-scene-presentation-element";

afterEach(() => document.body.replaceChildren());

it("admits adopted HTML and SVG roots while rejecting bare SVG fragments", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const foreign = frame.contentDocument!;
  const rectangle = foreign.createElement("div");
  const script = foreign.createElement("script");
  const svg = foreign.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = foreign.createElementNS("http://www.w3.org/2000/svg", "path");
  document.body.append(rectangle, script, svg, path);

  expect(rectangle.ownerDocument).toBe(document);
  expect(rectangle instanceof HTMLElement).toBe(false);
  expect(
    [rectangle, script, svg, path].map(isNativeScenePresentationElement),
  ).toEqual([true, true, true, false]);
});
