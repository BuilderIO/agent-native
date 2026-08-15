// @vitest-environment happy-dom
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { materializeClipPathShapes } from "./export-pptx-client";

const STYLE =
  "position: absolute; left: 3.631px; top: 133.58px; width: 191.887px; height: 166.037px;background: radial-gradient(circle at 0% 0%, #038DAF2d 0%, #038DAF2d 17%, #57308B38 62%, #57308B38 100%);clip-path: path('m143.6 14c-31.1-18.5-79.3-16.9-103-5.4-23.8 11.5-45.5 37.2-39.6 74.4 5.8 37.2 39.5 76.8 57.5 82 18 5.2 36.2-8.6 50.4-50.9 14.1-42.3 76.3 6.2 82.1-10.5 5.8-16.7-16.4-71-47.4-89.6z');";

it("emits the svg the browser would rasterize", () => {
  const element = document.createElement("div");
  element.setAttribute("style", STYLE);
  const root = document.createElement("div");
  root.appendChild(element);
  document.body.appendChild(root);
  materializeClipPathShapes(root);
  const svg = root.querySelector("svg")!;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "191.887");
  svg.setAttribute("height", "166.037");
  const after = new XMLSerializer().serializeToString(svg);
  const before = after
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .replace(/fill="url\(#[^)]*\)"/, 'fill="rgba(0, 0, 0, 0)"');
  writeFileSync("/tmp/canyon-after.svg", after);
  writeFileSync("/tmp/canyon-before.svg", before);
});
