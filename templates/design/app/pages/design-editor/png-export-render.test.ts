// @vitest-environment jsdom
import { expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  isolateSelectedExportElements,
  preserveLiveStylesheets,
  resolveExportCropRect,
  resolveExportCropTarget,
  resolveSelectedExportElements,
  PngCaptureError,
} from "./png-export-render";

it("preserves live CSSOM rules in direct export clones", () => {
  const source = document.implementation.createHTMLDocument();
  const style = source.createElement("style");
  style.textContent = ".runtime-rule { color: red; }";
  source.head.appendChild(style);
  const link = source.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://example.test/css/runtime.css";
  source.head.appendChild(link);
  Object.defineProperty(source, "styleSheets", {
    configurable: true,
    value: [
      {
        disabled: false,
        ownerNode: style,
        cssRules: [
          { cssText: ".runtime-rule { color: red; }" },
          { cssText: ".runtime-rule { background: blue; }" },
        ],
        href: null,
      },
      {
        disabled: false,
        ownerNode: link,
        cssRules: [
          { cssText: ".runtime-image { background: url(icon.png); }" },
        ],
        href: "https://example.test/css/runtime.css",
      },
    ] as unknown as StyleSheetList,
  });

  const cloned = source.cloneNode(true) as Document;
  expect(cloned.querySelector("style")?.textContent).not.toContain(
    "background: blue",
  );

  preserveLiveStylesheets(source, cloned);

  expect(cloned.querySelector("style")?.textContent).toContain(
    "background: blue",
  );
  const linkedRules = cloned.querySelector<HTMLStyleElement>(
    "style[data-agent-native-stylesheet-base]",
  );
  expect(linkedRules?.textContent).toContain("background: url(icon.png)");
  expect(linkedRules?.getAttribute("data-agent-native-stylesheet-base")).toBe(
    "https://example.test/css/runtime.css",
  );
  expect(
    cloned.documentElement.hasAttribute(
      "data-agent-native-export-resource-failures",
    ),
  ).toBe(false);
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

it("prefers runtime identity when source and runtime IDs point to different nodes", () => {
  const doc = document.implementation.createHTMLDocument();
  const source = doc.createElement("h1");
  source.setAttribute("data-agent-native-node-id", "source-node");
  const runtime = doc.createElement("h1");
  runtime.setAttribute("data-agent-native-node-id", "runtime-node");
  doc.body.append(source, runtime);

  expect(
    resolveSelectedExportElements(doc, {
      tagName: "H1",
      sourceId: "source-node",
      selector: '[data-agent-native-node-id="source-node"]',
      runtimeSourceId: "runtime-node",
      runtimeSelector: '[data-agent-native-node-id="runtime-node"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
    }),
  ).toEqual([runtime]);
});
