// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { insertClonedHtmlLayers } from "../clone-and-pen-edit";
import { resolvePastedSvgInsertionOptions } from "./paste-svg-layer";

vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: () => false,
}));

function paste(display: string, placement: "inside" | "after", originX = 80) {
  const content = `<html><body><section data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:400px;height:300px;display:${display}"><p data-agent-native-node-id="leaf">Text</p></section></body></html>`;
  const selectedElement = {
    sourceId: placement === "inside" ? "frame" : "leaf",
    selector: `[data-agent-native-node-id="${placement === "inside" ? "frame" : "leaf"}"]`,
    computedStyles: { display: placement === "inside" ? display : "block" },
    boundingRect: { x: originX, y: 90, width: 400, height: 300 },
    parentBoundingRect: { x: originX, y: 90, width: 400, height: 300 },
    parentDisplay: display,
  } as unknown as ElementInfo;
  const options = resolvePastedSvgInsertionOptions({
    activeFileId: "screen",
    targetFileId: "screen",
    baseContent: content,
    point: { x: originX + 120, y: 240 },
    selectedElement,
    selectedLayerTargets: [],
  });
  const result = insertClonedHtmlLayers(
    content,
    [
      '<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="pasted" style="position:absolute;width:40px;height:30px" width="40" height="30"><rect width="40" height="30"/></svg>',
    ],
    options,
  );
  expect(result).not.toBeNull();
  return new DOMParser()
    .parseFromString(result!.content, "text/html")
    .querySelector("svg")!;
}

describe("SVG paste placement through clone insertion", () => {
  it.each(["inside", "after"] as const)(
    "keeps local absolute coordinates %s a freeform selection",
    (placement) => {
      const svg = paste("block", placement);
      expect(svg.style.position).toBe("absolute");
      expect(svg.style.left).toBe("120px");
      expect(svg.style.top).toBe("150px");
      expect(svg.style.width).toBe("40px");
      expect(svg.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
        "frame",
      );
    },
  );
  it("rebases a paste point once for a frame far along the canvas", () => {
    const svg = paste("block", "inside", 8192);
    expect(svg.style.left).toBe("120px");
    expect(svg.style.top).toBe("150px");
  });
  it.each([undefined, { x: Number.NaN, y: 0, width: 100, height: 100 }])(
    "refuses insertion when the parent origin is unavailable",
    (parentBoundingRect) => {
      const options = resolvePastedSvgInsertionOptions({
        activeFileId: "screen",
        targetFileId: "screen",
        baseContent:
          '<html><body><p data-agent-native-node-id="leaf">Text</p></body></html>',
        point: { x: 120, y: 150 },
        selectedLayerTargets: [],
        selectedElement: {
          sourceId: "leaf",
          selector: '[data-agent-native-node-id="leaf"]',
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 20, height: 20 },
          parentBoundingRect,
        } as unknown as ElementInfo,
      });
      expect(options.positions).toBeUndefined();
      expect(options.positionError).toBe(
        parentBoundingRect
          ? "paste-position-geometry-invalid"
          : "paste-position-geometry-unavailable",
      );
    },
  );
  it.each(["flex", "grid"])("keeps SVGs in %s flow", (display) => {
    for (const placement of ["inside", "after"] as const) {
      const svg = paste(display, placement);
      expect(svg.style.position).toBe("");
      expect(svg.style.left).toBe("");
      expect(svg.style.top).toBe("");
      expect(svg.style.width).toBe("40px");
    }
  });
});
