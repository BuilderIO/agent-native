// @vitest-environment happy-dom

import { applyVisualEdit } from "@shared/code-layer";
import {
  appendPenNode,
  closePenPath,
  createCornerNode,
  parsePenNodes,
  resumePenPathAtEnd,
  translatePenPath,
  type PenPath,
} from "@shared/pen-path";
import { describe, expect, it } from "vitest";

import {
  penPathScreenContentOffset,
  primitiveVectorEditSource,
  writeBackPrimitiveAsVector,
  writeBackVectorEditedPenPath,
} from "./clone-and-pen-edit";

const editedPath: PenPath = {
  closed: true,
  nodes: [
    createCornerNode({ x: 33.75, y: -44.25 }),
    createCornerNode({ x: 44, y: -44.25 }),
    createCornerNode({ x: 44, y: -34 }),
    createCornerNode({ x: 33.75, y: -34 }),
  ],
};

describe("nested Pen path commits", () => {
  it("keeps parent-local placement, fractional geometry, and authored styles", () => {
    const html = `<!doctype html><main style="position:relative;left:18px;top:-157px">
      <svg data-agent-native-node-id="pen-1" viewBox="33.25 -74.5 10.25 10.5"
        style="position:absolute;left:15.5px;top:83.5px;width:10.25px;height:10.5px;opacity:0.5;filter:drop-shadow(0 1px 2px #000);transform:translate(2px, 3px);pointer-events:none">
        <path d="M 33.25 -74.5 L 43.5 -74.5 L 43.5 -64 L 33.25 -64 Z" fill="#336699" />
      </svg>
    </main>`;

    const updated = writeBackVectorEditedPenPath(html, "pen-1", editedPath);
    expect(updated).not.toBeNull();
    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    expect(svg?.style.left).toBe("16px");
    expect(svg?.style.top).toBe("113.75px");
    expect(svg?.style.width).toBe("10.25px");
    expect(svg?.style.height).toBe("10.25px");
    expect(svg?.style.opacity).toBe("0.5");
    expect(svg?.style.filter).toContain("drop-shadow");
    expect(svg?.style.transform).toBe("translate(2px, 3px)");
    expect(svg?.style.pointerEvents).toBe("none");
    expect(svg?.getAttribute("viewBox")).toBe("33.75 -44.25 10.25 10.25");
  });

  it("rebuilds a closed outside-aligned stroke while preserving SVG styles and fractional geometry", () => {
    const html = `<!doctype html><main style="position:relative">
      <svg data-agent-native-node-id="pen-aligned-closed" data-an-primitive="path"
        viewBox="33.25 -74.5 10.25 10.5"
        style="position:absolute;left:15.5px;top:83.5px;width:10.25px;height:10.5px;opacity:0.5;filter:drop-shadow(0 1px 2px #000);transform:translate(2px, 3px);overflow:hidden!important;pointer-events:none">
        <path d="M 33.25 -74.5 L 43.5 -74.5 L 43.5 -64 L 33.25 -64 Z" fill="#336699" stroke="#123456" stroke-width="2" />
      </svg>
    </main>`;
    const aligned = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-aligned-closed" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    expect(aligned.result.status).toBe("applied");

    const updated = writeBackVectorEditedPenPath(
      aligned.content,
      "pen-aligned-closed",
      editedPath,
    );
    expect(updated).not.toBeNull();
    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    expect(svg?.getAttribute("data-an-vector-stroke-position")).toBe("outside");
    expect(
      svg?.querySelector("use[data-an-vector-stroke-overlay]"),
    ).not.toBeNull();
    expect(svg?.style.width).toBe("10.25px");
    expect(svg?.style.opacity).toBe("0.5");
    expect(svg?.style.filter).toContain("drop-shadow");
    expect(svg?.style.transform).toBe("translate(2px, 3px)");
    expect(svg?.style.pointerEvents).toBe("none");
  });

  it("flattens an outside-aligned stroke when the path opens and restores original overflow", () => {
    const html = `<!doctype html><main style="position:relative">
      <svg data-agent-native-node-id="pen-aligned-open" data-an-primitive="path"
        viewBox="33.25 -74.5 10.25 10.5"
        style="position:absolute;left:15.5px;top:83.5px;width:10.25px;height:10.5px;opacity:0.5;filter:blur(1px);transform:translate(2px, 3px);overflow:hidden!important">
        <path d="M 33.25 -74.5 L 43.5 -74.5 L 43.5 -64 L 33.25 -64 Z" fill="#336699" stroke="#123456" stroke-width="2" />
      </svg>
    </main>`;
    const aligned = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-aligned-open" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    expect(aligned.result.status).toBe("applied");
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 33.75, y: -44.25 }),
        createCornerNode({ x: 44, y: -44.25 }),
        createCornerNode({ x: 44, y: -34 }),
      ],
    };

    const updated = writeBackVectorEditedPenPath(
      aligned.content,
      "pen-aligned-open",
      openPath,
    );
    expect(updated).not.toBeNull();
    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    const path = svg?.querySelector<SVGPathElement>(":scope > path");
    expect(svg?.querySelector("use[data-an-vector-stroke-overlay]")).toBeNull();
    expect(svg?.querySelector("defs[data-an-vector-stroke-defs]")).toBeNull();
    expect(svg?.getAttribute("data-an-vector-stroke-position")).toBeNull();
    expect(svg?.style.overflow).toBe("hidden");
    expect(svg?.style.getPropertyPriority("overflow")).toBe("important");
    expect(svg?.style.opacity).toBe("0.5");
    expect(svg?.style.filter).toBe("blur(1px)");
    expect(svg?.style.transform).toBe("translate(2px, 3px)");
    expect(path?.style.stroke).toBeTruthy();
  });

  it("refuses a closed path edit when an aligned stroke cannot be rebuilt", () => {
    const html = `<!doctype html><svg data-agent-native-node-id="pen-aligned-invalid" data-an-primitive="path"
      viewBox="33.25 -74.5 10.25 10.5" style="position:absolute;left:15px;top:80px;width:10px;height:10px">
      <path d="M 33.25 -74.5 L 43.5 -74.5 L 43.5 -64 L 33.25 -64 Z" fill="#336699" stroke="#123456" stroke-width="2" />
    </svg>`;
    const aligned = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-aligned-invalid" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    expect(aligned.result.status).toBe("applied");
    const unsupportedKind = aligned.content.replace(
      'data-an-primitive="path"',
      'data-an-primitive="unsupported"',
    );
    expect(
      writeBackVectorEditedPenPath(
        unsupportedKind,
        "pen-aligned-invalid",
        editedPath,
      ),
    ).toBeNull();
  });

  it("maps translated SVG coordinates into screen-content space", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "33.25 -74.5 10.25 10.5");
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 18, f: -157 }),
    });

    expect(penPathScreenContentOffset(svg)).toEqual({ x: 18, y: -157 });

    for (const matrix of [
      { a: 1.25, b: 0, c: 0, d: 1, e: 0, f: 0 }, // scale
      { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, // rotation
      { a: 1, b: 0.25, c: 0.5, d: 1, e: 0, f: 0 }, // skew
    ]) {
      Object.defineProperty(svg, "getScreenCTM", {
        configurable: true,
        value: () => matrix,
      });
      expect(penPathScreenContentOffset(svg)).toBeNull();
    }
  });
});

describe("continuing a committed open Pen path", () => {
  it("appends and closes in place while persisting the path nodes and fill", () => {
    const path: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 40, y: 0 }),
      ],
    };
    const continued = appendPenNode(
      resumePenPathAtEnd(path, { x: 40, y: 0 }, 8)!,
      createCornerNode({ x: 40, y: 30 }),
    );
    const html = `<!doctype html><svg data-agent-native-node-id="pen-continue" data-an-primitive="path"
      viewBox="0 0 40 30" style="position:absolute;left:0px;top:0px;width:40px;height:30px">
      <path d="M 0 0 L 40 0" fill="none" stroke="#000000" stroke-width="1" />
    </svg>`;

    const extended = writeBackVectorEditedPenPath(
      html,
      "pen-continue",
      continued,
    );
    expect(extended).not.toBeNull();
    const extendedDocument = new DOMParser().parseFromString(
      extended!,
      "text/html",
    );
    const extendedSvg = extendedDocument.querySelector("svg");
    expect(
      extendedDocument.querySelectorAll(
        '[data-agent-native-node-id="pen-continue"]',
      ),
    ).toHaveLength(1);
    expect(extendedSvg?.querySelector("path")?.getAttribute("d")).toBe(
      "M 0 0 L 40 0 L 40 30",
    );
    expect(extendedSvg?.getAttribute("data-an-pen-nodes")).not.toBeNull();
    expect(
      parsePenNodes(extendedSvg?.getAttribute("data-an-pen-nodes") ?? ""),
    ).toEqual(continued);
    expect(extendedSvg?.querySelector("path")?.getAttribute("fill")).toBe(
      "none",
    );

    const closed = writeBackVectorEditedPenPath(
      extended!,
      "pen-continue",
      closePenPath(continued),
    );
    expect(closed).not.toBeNull();
    const closedSvg = new DOMParser()
      .parseFromString(closed!, "text/html")
      .querySelector("svg");
    expect(closedSvg?.getAttribute("data-agent-native-node-id")).toBe(
      "pen-continue",
    );
    expect(closedSvg?.querySelector("path")?.getAttribute("d")).toBe(
      "M 0 0 L 40 0 L 40 30 L 0 0 Z",
    );
    expect(closedSvg?.querySelector("path")?.getAttribute("fill")).toBe(
      "rgb(218 218 218)",
    );
    expect(
      parsePenNodes(closedSvg?.getAttribute("data-an-pen-nodes") ?? ""),
    ).toEqual(closePenPath(continued));
  });
});

describe("shape-to-vector edit commits", () => {
  it("converts an ellipse in place while preserving style and fractional movement", () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><main style="position:relative">
        <div data-agent-native-node-id="ellipse-1" data-an-primitive="ellipse"
          style="position:absolute;left:15.25px;top:8.5px;width:20px;height:20px;background-color:rgb(204, 51, 102);border:0;border-radius:50%;opacity:0.5;filter:blur(1px);pointer-events:none"></div>
      </main>`,
      "text/html",
    );
    const element = doc.querySelector<HTMLElement>("[data-an-primitive]")!;
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({
        left: 35.25,
        top: 48.5,
        right: 55.25,
        bottom: 68.5,
        width: 20,
        height: 20,
        x: 35.25,
        y: 48.5,
        toJSON: () => ({}),
      }),
    });

    const source = primitiveVectorEditSource(element);
    expect(source?.geometry).toEqual({
      x: 35.25,
      y: 48.5,
      width: 20,
      height: 20,
    });
    expect(source?.path.nodes).toHaveLength(4);
    const moved = translatePenPath(source!.path, 0.25, 0.75);
    const updated = writeBackPrimitiveAsVector(
      doc.documentElement.outerHTML,
      "ellipse-1",
      moved,
      source!.geometry,
      source!.fill,
    );
    expect(updated).not.toBeNull();

    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    const path = svg?.querySelector("path");
    expect(svg?.style.left).toBe("15.5px");
    expect(svg?.style.top).toBe("9.25px");
    expect(svg?.style.opacity).toBe("0.5");
    expect(svg?.style.filter).toBe("blur(1px)");
    expect(svg?.style.pointerEvents).toBe("none");
    expect(path?.getAttribute("fill")).toBe(source?.fill);
    expect(svg?.getAttribute("data-an-pen-nodes")).toBeTruthy();
  });

  it("accepts a translated primitive and retains its authored transform", () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><main style="position:relative">
        <div data-agent-native-node-id="ellipse-translated" data-an-primitive="ellipse"
          style="position:absolute;left:15.25px;top:8.5px;width:20px;height:20px;transform:translate(10px, 5px);background-color:rgb(204, 51, 102);border:0;border-radius:50%"></div>
      </main>`,
      "text/html",
    );
    const element = doc.querySelector<HTMLElement>("[data-an-primitive]")!;
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({
        left: 45.25,
        top: 53.5,
        right: 65.25,
        bottom: 73.5,
        width: 20,
        height: 20,
        x: 45.25,
        y: 53.5,
        toJSON: () => ({}),
      }),
    });

    const source = primitiveVectorEditSource(element);
    expect(source?.geometry.x).toBe(45.25);
    expect(source?.geometry.y).toBe(53.5);
    const updated = writeBackPrimitiveAsVector(
      doc.documentElement.outerHTML,
      "ellipse-translated",
      translatePenPath(source!.path, 0.25, 0.75),
      source!.geometry,
      source!.fill,
    );
    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    expect(svg?.style.left).toBe("15.5px");
    expect(svg?.style.top).toBe("9.25px");
    expect(svg?.style.transform).toBe("translate(10px, 5px)");
  });

  it("refuses to replace a primitive that owns child content", () => {
    const doc = new DOMParser().parseFromString(
      `<div data-agent-native-node-id="ellipse-with-child" data-an-primitive="ellipse"
        style="position:absolute;left:0px;top:0px;width:20px;height:20px;border-radius:50%"><span>label</span></div>`,
      "text/html",
    );
    const element = doc.querySelector<HTMLElement>("[data-an-primitive]")!;
    expect(primitiveVectorEditSource(element)).toBeNull();
  });

  it("refuses transformed shapes instead of silently editing the wrong path", () => {
    const element = document.createElement("div");
    element.setAttribute("data-an-primitive", "rectangle");
    element.style.cssText =
      "position:absolute;left:0px;top:0px;width:20px;height:20px;transform:rotate(10deg)";
    expect(primitiveVectorEditSource(element)).toBeNull();
  });
});
