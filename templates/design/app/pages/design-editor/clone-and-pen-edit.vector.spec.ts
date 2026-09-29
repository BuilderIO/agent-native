// @vitest-environment happy-dom

import { applyVisualEdit } from "@shared/code-layer";
import {
  appendPenNode,
  closePenPath,
  createCornerNode,
  parsePenNodes,
  resumePenPathAtEnd,
  setPenNodeCornerRadius,
  serializePenNodes,
  serializePenPath,
  translatePenPath,
  type PenPath,
} from "@shared/pen-path";
import { describe, expect, it } from "vitest";

import {
  penPathForVectorEdit,
  penPathScreenContentOffset,
  primitiveVectorEditSource,
  writeBackPrimitiveAsVector,
  writeBackVectorEditedPenPath,
} from "./clone-and-pen-edit";

function expectFillOpacityHidden(path: Element | null) {
  expect(path).not.toBeNull();
  const style = (path as SVGPathElement).style;
  expect(style.getPropertyValue("fill-opacity")).toBe("0");
  expect(style.getPropertyPriority("fill-opacity")).toBe("important");
}

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
  it("updates only the selected child path in a grouped pasted SVG", () => {
    const firstPath: PenPath = {
      closed: true,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const secondPath: PenPath = {
      closed: true,
      nodes: [
        createCornerNode({ x: 50, y: 0 }),
        createCornerNode({ x: 80, y: 0 }),
        createCornerNode({ x: 80, y: 30 }),
      ],
    };
    const html = `<!doctype html><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"
      viewBox="0 0 80 40" style="position:absolute;left:10px;top:20px;width:80px;height:40px;overflow:hidden">
      <g>
        <path data-agent-native-node-id="first" data-an-pen-nodes="${serializePenNodes(firstPath)}"
          d="${serializePenPath(firstPath)}" fill="#f97316" />
        <path data-agent-native-node-id="second" data-an-pen-nodes="${serializePenNodes(secondPath)}"
          d="${serializePenPath(secondPath)}" fill="#16a34a" />
      </g></svg>`;
    const editedSecondPath = translatePenPath(secondPath, 5, 2);

    const updated = writeBackVectorEditedPenPath(
      html,
      "second",
      editedSecondPath,
    );
    const doc = new DOMParser().parseFromString(updated!, "text/html");
    const svg = doc.querySelector("svg");
    const first = doc.querySelector('[data-agent-native-node-id="first"]');
    const second = doc.querySelector('[data-agent-native-node-id="second"]');

    expect(updated).not.toBeNull();
    expect(first?.getAttribute("d")).toBe(serializePenPath(firstPath));
    expect(
      parsePenNodes(first?.getAttribute("data-an-pen-nodes") ?? ""),
    ).toEqual(firstPath);
    expect(second?.getAttribute("d")).toBe(serializePenPath(editedSecondPath));
    expect(
      parsePenNodes(second?.getAttribute("data-an-pen-nodes") ?? ""),
    ).toEqual(editedSecondPath);
    expect(second?.getAttribute("fill")).toBe("#16a34a");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 80 40");
    expect(svg?.style.left).toBe("10px");
    expect(svg?.style.top).toBe("20px");
    expect(svg?.style.width).toBe("80px");
    expect(svg?.style.height).toBe("40px");
    expect(svg?.style.overflow).toBe("visible");
  });

  it("preserves fill and stroke when a nested stroke-only path is reopened", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="stroke-only" data-an-pen-nodes="${serializePenNodes(closedPath)}"
        d="${serializePenPath(closedPath)}" fill="none" stroke="#000000" />
    </svg>`;

    const reopened = writeBackVectorEditedPenPath(
      html,
      "stroke-only",
      openPath,
    );
    expect(reopened).not.toBeNull();
    const reopenedPath = new DOMParser()
      .parseFromString(reopened!, "text/html")
      .querySelector("path");
    expect(reopenedPath?.getAttribute("fill")).toBe("none");
    expectFillOpacityHidden(reopenedPath);

    const reclosed = writeBackVectorEditedPenPath(
      reopened!,
      "stroke-only",
      closedPath,
    );
    const reclosedPath = new DOMParser()
      .parseFromString(reclosed!, "text/html")
      .querySelector("path");
    expect(reclosedPath?.getAttribute("fill")).toBe("none");
    expect(reclosedPath?.getAttribute("stroke")).toBe("#000000");
    expect(reclosedPath?.getAttribute("fill-opacity")).toBeNull();
  });

  it("restores an authored fill opacity after reopening and closing", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="partially-transparent" data-an-pen-nodes="${serializePenNodes(closedPath)}"
        d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0.4" stroke="none" />
    </svg>`;

    const reopened = writeBackVectorEditedPenPath(
      html,
      "partially-transparent",
      openPath,
    );
    expect(reopened).not.toBeNull();
    const reopenedPath = new DOMParser()
      .parseFromString(reopened!, "text/html")
      .querySelector("path");
    expect(reopenedPath?.getAttribute("fill-opacity")).toBe("0.4");
    expectFillOpacityHidden(reopenedPath);

    const reclosed = writeBackVectorEditedPenPath(
      reopened!,
      "partially-transparent",
      closedPath,
    );
    const reclosedPath = new DOMParser()
      .parseFromString(reclosed!, "text/html")
      .querySelector("path");
    expect(reclosedPath?.getAttribute("fill-opacity")).toBe("0.4");
    expect(reclosedPath?.getAttribute("stroke")).toBe("none");
  });

  it("rebuilds a stale opacity snapshot from authored SVG state", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="forged-opacity" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="forged-opacity-path"
        data-an-pen-nodes="${serializePenNodes(closedPath)}" d="${serializePenPath(closedPath)}"
        fill="#000000" fill-opacity="0" data-an-open-fill-opacity='{"version":2,"attributeValue":"0.4","restoreAttribute":true,"styleValue":null,"stylePriority":""}' />
    </svg>`;

    const opened = writeBackVectorEditedPenPath(
      html,
      "forged-opacity-path",
      openPath,
    )!;
    const openedPath = new DOMParser()
      .parseFromString(opened, "text/html")
      .querySelector("path")!;
    expect(
      JSON.parse(openedPath.getAttribute("data-an-open-fill-opacity")!),
    ).toMatchObject({ attributeValue: "0", restoreAttribute: false });

    const closed = writeBackVectorEditedPenPath(
      opened,
      "forged-opacity-path",
      closePenPath(openPath),
    )!;
    const closedElement = new DOMParser()
      .parseFromString(closed, "text/html")
      .querySelector("path")!;
    expect(closedElement.getAttribute("fill-opacity")).toBe("0");
    expect(closedElement.hasAttribute("data-an-open-fill-opacity")).toBe(false);
  });

  it("preserves root-path fill opacity while editing and reopening it", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const editedPath = translatePenPath(closedPath, 1, 1);
    const html = `<!doctype html><svg data-agent-native-node-id="root-vector" data-an-primitive="path"
      data-an-pen-nodes="${serializePenNodes(closedPath)}" viewBox="0 0 30 30"
      style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0.4" stroke="none" />
    </svg>`;

    const edited = writeBackVectorEditedPenPath(
      html,
      "root-vector",
      editedPath,
    );
    expect(edited).not.toBeNull();
    let svg = new DOMParser()
      .parseFromString(edited!, "text/html")
      .querySelector("svg");
    expect(svg?.querySelector("path")?.getAttribute("fill-opacity")).toBe(
      "0.4",
    );

    const reopened = writeBackVectorEditedPenPath(
      edited!,
      "root-vector",
      openPath,
    );
    expect(reopened).not.toBeNull();
    svg = new DOMParser()
      .parseFromString(reopened!, "text/html")
      .querySelector("svg");
    expect(svg?.querySelector("path")?.getAttribute("fill-opacity")).toBe(
      "0.4",
    );
    expectFillOpacityHidden(svg?.querySelector("path") ?? null);

    const reclosed = writeBackVectorEditedPenPath(
      reopened!,
      "root-vector",
      closedPath,
    );
    svg = new DOMParser()
      .parseFromString(reclosed!, "text/html")
      .querySelector("svg");
    expect(svg?.querySelector("path")?.getAttribute("fill-opacity")).toBe(
      "0.4",
    );
  });

  it("persists one rounded anchor through vector writeback and node rehydration", () => {
    const path = closePenPath(
      appendPenNode(
        appendPenNode(
          appendPenNode(
            appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
            createCornerNode({ x: 100, y: 0 }),
          ),
          createCornerNode({ x: 100, y: 100 }),
        ),
        createCornerNode({ x: 0, y: 100 }),
      ),
    );
    const rounded = setPenNodeCornerRadius(path, 1, 12)!;
    const html = `<!doctype html><svg data-agent-native-node-id="rounded-pen" data-an-primitive="path"
      viewBox="0 0 100 100" style="position:absolute;left:0px;top:0px;width:100px;height:100px">
      <path d="${serializePenPath(path)}" fill="#336699" /></svg>`;

    const updated = writeBackVectorEditedPenPath(html, "rounded-pen", rounded);
    const svg = new DOMParser()
      .parseFromString(updated!, "text/html")
      .querySelector("svg");
    const persisted = parsePenNodes(
      svg?.getAttribute("data-an-pen-nodes") ?? "",
    );

    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      serializePenPath(rounded),
    );
    expect(persisted?.nodes[1]?.cornerRadius).toBe(12);
    expect(persisted?.nodes.filter((node) => node.cornerRadius).length).toBe(1);
  });

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

describe("editing a resized vector", () => {
  it("places anchors where the scaled SVG draws them and re-bases it at 1:1 on commit", () => {
    const path: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 100, y: 50 }),
      ],
    };
    const html = `<!DOCTYPE html><html><body><svg data-agent-native-node-id="resized" data-an-primitive="path" viewBox="0 0 100 50" preserveAspectRatio="none" style="position: absolute; left: 10px; top: 20px; width: 200px; height: 100px" data-an-pen-nodes='${serializePenNodes(path)}'><path d="${serializePenPath(path)}" fill="none" stroke="#000"></path></svg></body></html>`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    svg.style.width = "200px";
    svg.style.height = "100px";
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }),
    });

    const editable = penPathForVectorEdit(svg, path, { x: 0, y: 0 });
    expect(editable?.path.nodes.map((node) => node.point)).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 120 },
    ]);

    const committed = writeBackVectorEditedPenPath(
      html,
      "resized",
      translatePenPath(
        editable!.path,
        -editable!.sourceOffset.x,
        -editable!.sourceOffset.y,
      ),
    );
    const committedSvg = new DOMParser()
      .parseFromString(committed!, "text/html")
      .querySelector<SVGSVGElement>('[data-agent-native-node-id="resized"]')!;
    expect(committedSvg.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(committedSvg.style.left).toBe("10px");
    expect(committedSvg.style.width).toBe("200px");
    expect(committedSvg.style.height).toBe("100px");
  });
});

describe("editing a CSS-transformed vector", () => {
  it("refuses a scale that write-back would keep applying", () => {
    const path: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 100, y: 50 }),
      ],
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    svg.style.width = "200px";
    svg.style.height = "100px";
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 4, b: 0, c: 0, d: 4, e: 10, f: 20 }),
    });

    expect(penPathForVectorEdit(svg, path, { x: 0, y: 0 })).toBeNull();
  });
});

describe("continuing a committed open Pen path", () => {
  it("keeps an explicit fill-opacity attribute edit through a legacy marker close", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const html = `<!doctype html><svg data-agent-native-node-id="legacy-open" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="legacy-open-path" data-an-pen-nodes="${serializePenNodes(openPath)}"
        d="${serializePenPath(openPath)}" fill="#000000" fill-opacity="0"
        data-an-open-fill-opacity="value:0.4" />
    </svg>`;
    const opened = writeBackVectorEditedPenPath(
      html,
      "legacy-open-path",
      openPath,
    )!;
    const attributeEdit = applyVisualEdit(opened, {
      kind: "attribute",
      target: { nodeId: "legacy-open-path" },
      name: "fill-opacity",
      value: "0",
    });

    expect(attributeEdit.result.status).toBe("applied");
    const openElement = new DOMParser()
      .parseFromString(attributeEdit.content, "text/html")
      .querySelector("path")!;
    expect(
      JSON.parse(openElement.getAttribute("data-an-open-fill-opacity")!),
    ).toMatchObject({ restoreAttribute: false });

    const closed = writeBackVectorEditedPenPath(
      attributeEdit.content,
      "legacy-open-path",
      closePenPath(openPath),
    )!;
    const closedElement = new DOMParser()
      .parseFromString(closed, "text/html")
      .querySelector("path");

    expect(closedElement?.getAttribute("fill-opacity")).toBe("0");
  });

  it("preserves authored zero fill opacity when closing an open path", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const html = `<!doctype html><svg data-agent-native-node-id="authored-open" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-an-pen-nodes="${serializePenNodes(openPath)}" d="${serializePenPath(openPath)}"
        fill="#000000" fill-opacity="0" stroke="#000000" />
    </svg>`;

    for (const content of [
      html,
      writeBackVectorEditedPenPath(html, "authored-open", openPath)!,
    ]) {
      const closed = writeBackVectorEditedPenPath(
        content,
        "authored-open",
        closePenPath(openPath),
      );
      const closedPath = new DOMParser()
        .parseFromString(closed!, "text/html")
        .querySelector("path");

      expect(closedPath?.getAttribute("fill-opacity")).toBe("0");
    }
  });

  it("preserves a fill-opacity style edit made while the path is open", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="edited-opacity" data-an-pen-nodes="${serializePenNodes(closedPath)}"
        d="${serializePenPath(closedPath)}" fill="#000000" style="fill-opacity: 0.4" />
    </svg>`;

    const reopened = writeBackVectorEditedPenPath(
      html,
      "edited-opacity",
      openPath,
    );
    expect(reopened).not.toBeNull();
    const openedPath = new DOMParser()
      .parseFromString(reopened!, "text/html")
      .querySelector("path")!;
    expectFillOpacityHidden(openedPath);

    openedPath.style.setProperty("fill-opacity", "0.7");
    const updatedWhileOpen = writeBackVectorEditedPenPath(
      `<!doctype html>\n${openedPath.ownerDocument.documentElement.outerHTML}`,
      "edited-opacity",
      translatePenPath(openPath, 1, 1),
    );
    expect(updatedWhileOpen).not.toBeNull();
    expectFillOpacityHidden(
      new DOMParser()
        .parseFromString(updatedWhileOpen!, "text/html")
        .querySelector("path"),
    );
    const reclosed = writeBackVectorEditedPenPath(
      updatedWhileOpen!,
      "edited-opacity",
      closePenPath(translatePenPath(openPath, 1, 1)),
    );
    const restoredPath = new DOMParser()
      .parseFromString(reclosed!, "text/html")
      .querySelector("path");

    expect(restoredPath?.style.getPropertyValue("fill-opacity")).toBe("0.7");
    expect(restoredPath?.style.getPropertyPriority("fill-opacity")).toBe("");
  });

  it("preserves an authored zero-opacity edit made while the path is open", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="zero-opacity" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-an-pen-nodes="${serializePenNodes(closedPath)}" d="${serializePenPath(closedPath)}"
        fill="#000000" fill-opacity="0.4" />
    </svg>`;
    const opened = writeBackVectorEditedPenPath(
      html,
      "zero-opacity",
      openPath,
    )!;
    const openedPath = new DOMParser()
      .parseFromString(opened, "text/html")
      .querySelector("path")!;
    openedPath.setAttribute("fill-opacity", "0");
    const edited = writeBackVectorEditedPenPath(
      `<!doctype html>\n${openedPath.ownerDocument.documentElement.outerHTML}`,
      "zero-opacity",
      translatePenPath(openPath, 1, 1),
    )!;
    const closed = writeBackVectorEditedPenPath(
      edited,
      "zero-opacity",
      closePenPath(translatePenPath(openPath, 1, 1)),
    );

    const restoredPath = new DOMParser()
      .parseFromString(closed!, "text/html")
      .querySelector("path");
    expect(restoredPath?.getAttribute("fill-opacity")).toBe("0");
  });

  it("preserves an inspector zero-opacity edit made while the fill is hidden", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="zero-opacity" data-an-primitive="path"
      data-an-pen-nodes="${serializePenNodes(closedPath)}" viewBox="0 0 30 30"
      style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0.4" />
    </svg>`;
    const opened = writeBackVectorEditedPenPath(
      html,
      "zero-opacity",
      openPath,
    )!;
    const opacityEdit = applyVisualEdit(opened, {
      kind: "style",
      target: { nodeId: "zero-opacity" },
      property: "fill-opacity",
      value: "0",
    });

    expect(opacityEdit.result.status).toBe("applied");
    const openDocument = new DOMParser().parseFromString(
      opacityEdit.content,
      "text/html",
    );
    const openElement = openDocument.querySelector("path")!;
    expectFillOpacityHidden(openElement);
    expect(
      JSON.parse(openElement.getAttribute("data-an-open-fill-opacity")!),
    ).toMatchObject({
      styleValue: "0",
      stylePriority: "",
    });

    const closed = writeBackVectorEditedPenPath(
      opacityEdit.content,
      "zero-opacity",
      closePenPath(openPath),
    )!;
    const closedElement = new DOMParser()
      .parseFromString(closed, "text/html")
      .querySelector("path")!;
    expect(closedElement.style.getPropertyValue("fill-opacity")).toBe("0");
    expect(closedElement.style.getPropertyPriority("fill-opacity")).toBe("");
  });

  it.each(["", "not-json"])(
    "rejects opacity edits when an open path's saved state is %j",
    (markerValue) => {
      const openPath: PenPath = {
        closed: false,
        nodes: [
          createCornerNode({ x: 0, y: 0 }),
          createCornerNode({ x: 30, y: 0 }),
          createCornerNode({ x: 30, y: 30 }),
        ],
      };
      const closedPath = closePenPath(openPath);
      const html = `<!doctype html><svg data-agent-native-node-id="invalid-opacity" data-an-primitive="path"
      data-an-pen-nodes="${serializePenNodes(closedPath)}" viewBox="0 0 30 30"
      style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0.4" />
    </svg>`;
      const opened = writeBackVectorEditedPenPath(
        html,
        "invalid-opacity",
        openPath,
      )!;
      const malformed = opened.replace(
        /data-an-open-fill-opacity="[^"]*"/,
        `data-an-open-fill-opacity="${markerValue}"`,
      );
      const result = applyVisualEdit(malformed, {
        kind: "style",
        target: { nodeId: "invalid-opacity" },
        property: "fill-opacity",
        value: "0.5",
      });

      expect(result.result.status).toBe("unsupported");
      expect(result.content).toBe(malformed);
    },
  );

  it("removes authored fill opacity without revealing an open path's fill", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const closedPath = closePenPath(openPath);
    const html = `<!doctype html><svg data-agent-native-node-id="remove-opacity" data-an-primitive="path"
      data-an-pen-nodes="${serializePenNodes(closedPath)}" viewBox="0 0 30 30"
      style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0.4"
        style="fill-opacity: 0.6" />
    </svg>`;
    const opened = writeBackVectorEditedPenPath(
      html,
      "remove-opacity",
      openPath,
    )!;
    const removed = applyVisualEdit(opened, {
      kind: "style",
      target: { nodeId: "remove-opacity" },
      property: "fill-opacity",
      operation: "remove",
    });

    expect(removed.result.status).toBe("applied");
    expectFillOpacityHidden(
      new DOMParser()
        .parseFromString(removed.content, "text/html")
        .querySelector("path"),
    );
    const closed = writeBackVectorEditedPenPath(
      removed.content,
      "remove-opacity",
      closePenPath(openPath),
    )!;
    const closedElement = new DOMParser()
      .parseFromString(closed, "text/html")
      .querySelector("path")!;
    expect(closedElement.style.getPropertyValue("fill-opacity")).toBe("");
    expect(closedElement.getAttribute("fill-opacity")).toBe("0.4");
  });

  it("migrates legacy opacity markers before an open-path edit", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const html = `<!doctype html><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="legacy-opacity" data-an-pen-nodes='${serializePenNodes(openPath)}'
        d="${serializePenPath(openPath)}" fill="#000000" fill-opacity="0"
        data-an-open-fill-opacity="value:0.4" style="fill-opacity: 0.6;" />
    </svg>`;

    const edited = writeBackVectorEditedPenPath(
      html,
      "legacy-opacity",
      translatePenPath(openPath, 1, 1),
    );
    expect(edited).not.toBeNull();
    const editedPath = new DOMParser()
      .parseFromString(edited!, "text/html")
      .querySelector("path")!;
    expectFillOpacityHidden(editedPath);

    const closed = writeBackVectorEditedPenPath(
      edited!,
      "legacy-opacity",
      closePenPath(translatePenPath(openPath, 1, 1)),
    );
    expect(closed).not.toBeNull();
    const closedPath = new DOMParser()
      .parseFromString(closed!, "text/html")
      .querySelector("path")!;
    expect(closedPath.getAttribute("fill-opacity")).toBe("0.4");
    expect(closedPath.style.getPropertyValue("fill-opacity")).toBe("0.6");
    expect(closedPath.style.getPropertyPriority("fill-opacity")).toBe("");
    expect(closedPath.hasAttribute("data-an-open-fill-opacity")).toBe(false);
  });

  it("preserves authored zero fill opacity on a closed path", () => {
    const closedPath = closePenPath({
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    });
    const html = `<!doctype html><svg data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-agent-native-node-id="authored-zero" data-an-pen-nodes="${serializePenNodes(closedPath)}"
        d="${serializePenPath(closedPath)}" fill="#000000" fill-opacity="0" stroke="none" />
    </svg>`;

    const edited = writeBackVectorEditedPenPath(
      html,
      "authored-zero",
      translatePenPath(closedPath, 1, 1),
    );
    const editedPath = new DOMParser()
      .parseFromString(edited!, "text/html")
      .querySelector("path");

    expect(editedPath?.getAttribute("fill-opacity")).toBe("0");
  });

  it("preserves ambiguous markerless zero fill opacity when closing an open path", () => {
    const openPath: PenPath = {
      closed: false,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 30, y: 0 }),
        createCornerNode({ x: 30, y: 30 }),
      ],
    };
    const html = `<!doctype html><svg data-agent-native-node-id="legacy" data-an-primitive="pasted-svg"
      viewBox="0 0 30 30" style="position:absolute;left:0px;top:0px;width:30px;height:30px">
      <path data-an-pen-nodes="${serializePenNodes(openPath)}" d="${serializePenPath(openPath)}"
        fill="none" fill-opacity="0" stroke="#000000" />
    </svg>`;

    const closed = writeBackVectorEditedPenPath(
      html,
      "legacy",
      closePenPath(openPath),
    );
    const closedPath = new DOMParser()
      .parseFromString(closed!, "text/html")
      .querySelector("path");

    expect(closedPath?.getAttribute("fill-opacity")).toBe("0");
    expect(closedPath?.getAttribute("stroke")).toBe("#000000");
  });

  it("appends and closes in place while preserving stroke-only paint", () => {
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
    expect(closedSvg?.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(closedSvg?.querySelector("path")?.getAttribute("stroke")).toBe(
      "#000000",
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
