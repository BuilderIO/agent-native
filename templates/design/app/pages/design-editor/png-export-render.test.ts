// @vitest-environment jsdom
import { expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  isolateSelectedExportElements,
  normalizeHtml2CanvasImage,
  resolveExportCropRect,
  resolveExportCropTarget,
  resolveSelectedExportElements,
  PngCaptureError,
} from "./png-export-render";

it("normalizes sRGB gradient stops without changing sibling color spaces or images", () => {
  const sibling = "linear-gradient(color(srgb 1 0 0), color(srgb 0 0 1))";
  const image = 'url("https://example.test/image.png")';
  const gradient =
    "linear-gradient(90deg in srgb, color(srgb 1 0 0 / 0.2) 0%, color(srgb 0 0 1 / 0) 100%)";
  expect(normalizeHtml2CanvasImage(`${gradient}, ${sibling}, ${image}`)).toBe(
    `linear-gradient(90deg, rgba(255, 0, 0, 0.2) 0%, rgba(0, 0, 255, 0) 100%), ${sibling}, ${image}`,
  );
});

it("isolates selected exports from overlapping siblings and ancestor paint", () => {
  const source = document.implementation.createHTMLDocument();
  source.documentElement.style.backgroundColor = "rgb(1, 2, 3)";
  source.body.style.backgroundColor = "rgb(4, 5, 6)";
  const host = source.createElement("main");
  host.style.backgroundColor = "rgb(0, 255, 0)";
  const frame = source.createElement("div");
  frame.style.backgroundColor = "rgb(255, 255, 255)";
  const child = source.createElement("div");
  child.style.backgroundColor = "rgb(255, 0, 0)";
  frame.appendChild(child);
  const overlapping = source.createElement("div");
  overlapping.style.position = "absolute";
  overlapping.style.left = "0";
  overlapping.style.top = "0";
  overlapping.style.width = "100px";
  overlapping.style.height = "80px";
  overlapping.style.backgroundColor = "rgb(0, 0, 255)";
  const visibleDescendant = source.createElement("div");
  visibleDescendant.style.visibility = "visible";
  visibleDescendant.style.backgroundColor = "rgb(255, 255, 0)";
  overlapping.appendChild(visibleDescendant);
  host.appendChild(frame);
  host.appendChild(overlapping);
  source.body.appendChild(host);

  const selectedFrame: ElementInfo = {
    tagName: "DIV",
    selector: "main > div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 80 },
    isFlexChild: false,
    isFlexContainer: false,
  };
  const selectedElements = resolveSelectedExportElements(source, selectedFrame);
  expect(selectedElements).toEqual([frame]);

  const cloned = source.cloneNode(true) as Document;
  const html2canvasPseudo = cloned.createElement("html2canvaspseudoelement");
  cloned.body.insertBefore(html2canvasPseudo, cloned.body.firstChild);
  isolateSelectedExportElements(source, cloned, selectedElements);

  expect(
    cloned.documentElement.style.getPropertyValue("background-color"),
  ).toBe("transparent");
  expect(cloned.body.style.getPropertyValue("background-color")).toBe(
    "transparent",
  );
  expect(
    cloned
      .querySelector<HTMLElement>("main")
      ?.style.getPropertyValue("background-color"),
  ).toBe("transparent");
  expect(
    cloned
      .querySelector<HTMLElement>("main > div")
      ?.style.getPropertyValue("background-color"),
  ).toBe("rgb(255, 255, 255)");
  expect(
    cloned
      .querySelector<HTMLElement>("main > div > div")
      ?.style.getPropertyValue("background-color"),
  ).toBe("rgb(255, 0, 0)");
  expect(
    cloned
      .querySelector<HTMLElement>("main > div + div")
      ?.style.getPropertyValue("opacity"),
  ).toBe("0");
  expect(
    cloned
      .querySelector<HTMLElement>("main > div + div > div")
      ?.style.getPropertyValue("background-color"),
  ).toBe("rgb(255, 255, 0)");
  expect(
    cloned
      .querySelector<HTMLElement>("main")
      ?.style.getPropertyValue("box-shadow"),
  ).toBe("none");
  expect(
    cloned
      .querySelector<HTMLElement>("main")
      ?.style.getPropertyValue("border-top-color"),
  ).toBe("transparent");
  expect(source.body.style.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(host.style.backgroundColor).toBe("rgb(0, 255, 0)");
});

it("does not isolate a screen-root export from its authored background", () => {
  const source = document.implementation.createHTMLDocument();
  source.body.style.backgroundColor = "rgb(4, 5, 6)";
  const screenRoot: ElementInfo = {
    tagName: "BODY",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 300, height: 200 },
    isFlexChild: false,
    isFlexContainer: false,
  };

  expect(resolveSelectedExportElements(source, screenRoot)).toEqual([]);
  const cloned = source.cloneNode(true) as Document;
  isolateSelectedExportElements(source, cloned, []);
  expect(cloned.body.style.backgroundColor).toBe("rgb(4, 5, 6)");
});

it("treats a Screen root as whole-screen while keeping ordinary isolation strict", () => {
  const source = document.implementation.createHTMLDocument();
  const selected = source.createElement("div");
  selected.setAttribute("data-agent-native-node-id", "selected");
  source.body.appendChild(selected);
  const screenRoot: ElementInfo = {
    tagName: "BODY",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 300, height: 200 },
    isFlexChild: false,
    isFlexContainer: false,
  };
  const selectedFrame: ElementInfo = {
    tagName: "DIV",
    sourceId: "selected",
    selector: "[data-agent-native-node-id=selected]",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    isFlexChild: false,
    isFlexContainer: false,
  };

  expect(() =>
    resolveSelectedExportElements(source, [screenRoot, selectedFrame]),
  ).toThrow(expect.objectContaining({ code: "selection-unresolved" }));
  expect(resolveExportCropTarget(source, [screenRoot, selectedFrame])).toEqual({
    kind: "whole-screen",
  });
  expect(resolveExportCropRect(source, [screenRoot, selectedFrame])).toBeNull();
});

it("fails selected export isolation when the clone lost the requested node", () => {
  const source = document.implementation.createHTMLDocument();
  const selected = source.createElement("div");
  selected.setAttribute("data-agent-native-node-id", "node-a");
  source.body.appendChild(selected);
  const cloned = source.cloneNode(true) as Document;
  cloned.querySelector("[data-agent-native-node-id='node-a']")?.remove();

  expect(() =>
    isolateSelectedExportElements(source, cloned, [selected]),
  ).toThrow(expect.objectContaining({ code: "selection-unresolved" }));
  expect(() =>
    resolveSelectedExportElements(source, {
      tagName: "DIV",
      selector: "[data-agent-native-node-id='missing']",
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      isFlexChild: false,
      isFlexContainer: false,
    }),
  ).toThrow(PngCaptureError);
});
