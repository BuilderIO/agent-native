// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
} from "@shared/code-layer";
import type { CodeLayerSource } from "@shared/code-layer";
import {
  analyzeComponentLinks,
  applyComponentPropertyEdit,
} from "@shared/component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "@shared/component-model";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PortableStyleSnapshot } from "@/components/design/types";

import {
  insertClonedHtmlLayers,
  extractLayerPosition,
  measurePreparedCloneVisualOffset,
  prepareClonedHtmlLayersForLiveInsert,
  preserveClipboardLayerName,
} from "./clone-and-pen-edit";

const LIVE_URL = "http://localhost:5173/products?preview=1";

function testRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockPreparedProbeGeometry(
  parent: HTMLElement,
  onProbeRect?: (element: Element) => void,
  probeRect = testRect(0, 0, 100, 50),
) {
  const getClientRects = vi
    .spyOn(Element.prototype, "getClientRects")
    .mockImplementation(function (this: Element) {
      return this === parent ||
        this.getAttribute("data-agent-native-edit-overlay") ===
          "paste-position-probe"
        ? ([testRect(0, 0, 400, 300)] as unknown as DOMRectList)
        : ([] as unknown as DOMRectList);
    });
  const getBoundingClientRect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this === parent) return testRect(0, 0, 400, 300);
      if (
        this.getAttribute("data-agent-native-edit-overlay") ===
        "paste-position-probe"
      ) {
        onProbeRect?.(this);
        return probeRect;
      }
      return testRect(0, 0, 0, 0);
    });
  return () => {
    getClientRects.mockRestore();
    getBoundingClientRect.mockRestore();
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("extractLayerPosition", () => {
  it("returns authored layout coordinates without applying the transform", () => {
    expect(
      extractLayerPosition(
        '<div style="position:absolute;left:40px;top:120px;transform:translate(16px, 24px) rotate(2deg)"></div>',
      ),
    ).toEqual({ x: 40, y: 120 });
  });

  it("does not treat an in-flow transform as absolute placement", () => {
    expect(
      extractLayerPosition(
        '<div style="transform:translate3d(12px, 18px, 0)"></div>',
      ),
    ).toBeNull();
  });

  it("preserves transform and sizing when positioning a clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="source" style="position:absolute;left:40px;top:120px;width:180px;height:64px;transform:translate(16px, 24px) rotate(2deg)">Source</div>',
      ],
      { positions: [{ x: 50, y: 130 }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect((clone as HTMLElement).style.left).toBe("50px");
    expect((clone as HTMLElement).style.top).toBe("130px");
    expect((clone as HTMLElement).style.width).toBe("180px");
    expect((clone as HTMLElement).style.height).toBe("64px");
    expect((clone as HTMLElement).style.transform).toBe(
      "translate(16px, 24px) rotate(2deg)",
    );
  });

  it("clears an authored inset before positioning a clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;inset:10px 20px 30px 40px;width:100px;height:50px">Source</div>',
      ],
      { positions: [{ x: 50, y: 60 }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.getPropertyValue("inset")).toBe("");
    expect([clone.style.position, clone.style.left, clone.style.top]).toEqual([
      "absolute",
      "50px",
      "60px",
    ]);
    expect([clone.style.right, clone.style.bottom]).toEqual(["", ""]);
  });

  it("preserves opposing relative offsets and RTL when moving a fractional clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div dir="rtl" data-agent-native-node-id="source" data-note="kept" style="position:relative;left:40.25px;top:12.5px;right:7.75px;bottom:9.25px;margin:3px 4px">Source</div>',
      ],
      {
        positions: [
          { x: 56.25, y: 28.5, positionMode: "relative", space: "layout" },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([
      clone.style.position,
      clone.style.left,
      clone.style.top,
      clone.style.right,
      clone.style.bottom,
      clone.style.margin,
      clone.getAttribute("dir"),
    ]).toEqual([
      "relative",
      "56.25px",
      "28.5px",
      "7.75px",
      "9.25px",
      "3px 4px",
      "rtl",
    ]);
    expect(clone.getAttribute("data-note")).toBe("kept");
    expect(clone.textContent).toBe("Source");
  });

  it("keeps a relative inset shorthand when updating fractional coordinates", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div dir="rtl" data-agent-native-node-id="source" style="position:relative;inset:12.5px 7.75px 9.25px 40.25px">Source</div>',
      ],
      {
        positions: [
          { x: 56.25, y: 28.5, positionMode: "relative", space: "layout" },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([
      clone.style.position,
      clone.style.left,
      clone.style.top,
      clone.style.getPropertyValue("inset"),
      clone.getAttribute("dir"),
    ]).toEqual([
      "relative",
      "56.25px",
      "28.5px",
      "12.5px 7.75px 9.25px 40.25px",
      "rtl",
    ]);
  });

  it("clears an authored inset when stripping root placement", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;inset:10px 20px 30px 40px;width:100px;height:50px">Source</div>',
      ],
      { stripRootPosition: true },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([
      clone.style.position,
      clone.style.getPropertyValue("inset"),
      clone.style.left,
      clone.style.top,
      clone.style.right,
      clone.style.bottom,
    ]).toEqual(["", "", "", "", "", ""]);
  });

  it("preserves live node identity when preparing a move", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="source" data-agent-native-source-id="source" style="transform:translate3d(60px, 0, 0)"><span data-agent-native-node-id="child">Source</span></div>',
      ],
      { preserveIncomingNodeIds: true },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-node-id")).toBe("source");
    expect(
      clone.querySelector("span")?.getAttribute("data-agent-native-node-id"),
    ).toBe("child");
    expect((clone as HTMLElement).style.transform).toBe(
      "translate3d(60px, 0, 0)",
    );
  });

  it("keeps a transform-inclusive paste target near the canvas origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 1;
        readonly b = 0;
        readonly c = 0;
        readonly d = 1;
        readonly e = 100;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="source" style="position:absolute;left:100px;top:40px;width:100px;height:50px;transform:translateX(100px)">Source</div>',
      ],
      {
        positions: [{ x: 50, y: 40, space: "visual" }],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect((clone as HTMLElement).style.left).toBe("-50px");
    expect((clone as HTMLElement).style.top).toBe("40px");
    expect((clone as HTMLElement).style.transform).toBe("translateX(100px)");
  });

  it("places a rotated layer by its transformed bounds around the default origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 0;
        readonly b = 1;
        readonly c = -1;
        readonly d = 0;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:0;top:0;width:100px;height:50px;transform:rotate(90deg)">Rotated</div>',
      ],
      { positions: [{ x: 50, y: 60, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.left).toBe("25px");
    expect(clone.style.top).toBe("85px");
  });

  it("pastes an auto-height rotated card with measured visual geometry", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:40px;top:60px;width:260px;transform:rotate(2deg)">Card</div>',
      ],
      {
        positions: [
          {
            x: 50,
            y: 40,
            space: "visual",
            visualOffset: { x: -2, y: -5 },
          },
        ],
      },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([clone.style.left, clone.style.top]).toEqual(["52px", "45px"]);
    expect(clone.style.width).toBe("260px");
    expect(clone.style.height).toBe("");
    expect(clone.style.transform).toBe("rotate(2deg)");
  });

  it("preserves fractional visual offsets when placing a clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      ['<div style="width:100px;height:50px">Card</div>'],
      {
        positions: [
          {
            x: 34,
            y: 109,
            space: "visual",
            visualOffset: { x: 0.25, y: 0.75 },
          },
        ],
      },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([clone.style.left, clone.style.top]).toEqual([
      "33.75px",
      "108.25px",
    ]);
  });

  it("refuses visual placement when auto transformed geometry was not measured", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div class="responsive-card" style="position:absolute;width:auto;height:auto;transform:rotate(2deg)">Card</div>',
      ],
      { positions: [{ x: 50, y: 40, space: "visual" }] },
    );

    expect(result).toBeNull();
  });

  it("normalizes a single top transform-origin keyword", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 0;
        readonly b = 1;
        readonly c = -1;
        readonly d = 0;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="width:100px;height:50px;transform:rotate(90deg);transform-origin:top">Card</div>',
      ],
      { positions: [{ x: 50, y: 60, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([clone.style.left, clone.style.top]).toEqual(["50px", "110px"]);
    expect(clone.style.transformOrigin).toBe("top");
  });

  it("includes explicit pixel margins in unmeasured visual placement", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 1;
        readonly b = 0;
        readonly c = 0;
        readonly d = 1;
        readonly e = 5;
        readonly f = 6;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="width:100px;height:50px;margin-left:13px;margin-top:17px;transform:translate(5px,6px)">Card</div>',
      ],
      { positions: [{ x: 50, y: 40, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect([clone.style.left, clone.style.top]).toEqual(["32px", "17px"]);
    expect([clone.style.marginLeft, clone.style.marginTop]).toEqual([
      "13px",
      "17px",
    ]);
  });

  it("cleans the preview probe and imported styles when geometry is unavailable", () => {
    const parent = document.createElement("div");
    parent.style.position = "relative";
    const target = document.createElement("div");
    parent.append(target);
    document.body.append(parent);
    Object.defineProperty(parent, "getBoxQuads", {
      value: () => [
        {
          p1: { x: 0, y: 0 },
          p2: { x: 300, y: 0 },
          p3: { x: 300, y: 200 },
          p4: { x: 0, y: 200 },
        },
      ],
    });

    const observedProbeWithStyles: boolean[] = [];
    const getClientRects = vi
      .spyOn(Element.prototype, "getClientRects")
      .mockImplementation(function (this: Element) {
        if (
          this.getAttribute("data-agent-native-edit-overlay") ===
          "paste-position-probe"
        ) {
          observedProbeWithStyles.push(
            parent.contains(this) &&
              this.nextElementSibling === target &&
              document.head.querySelector(
                'style[data-agent-native-breakpoints][data-agent-native-edit-overlay="paste-position-probe-style"]',
              ) !== null,
          );
        }
        return [] as unknown as DOMRectList;
      });

    let offset: { x: number; y: number } | null;
    try {
      offset = measurePreparedCloneVisualOffset(
        target,
        '<div data-agent-native-node-id="source" class="copy-card" style="width:auto;height:auto;transform:scale(1.2)">Card</div>',
        {
          managedStyleSnapshot: {
            version: 1,
            breakpoints: [
              {
                maxWidthPx: 900,
                nodeId: "source",
                property: "width",
                value: "320px",
              },
            ],
            interactionStates: [],
          },
          view: window,
          renderOffset: { x: 0, y: 0 },
        },
      );
    } finally {
      getClientRects.mockRestore();
      parent.remove();
    }

    expect(offset).toBeNull();
    expect(observedProbeWithStyles).toEqual([true]);
    expect(
      document.querySelector(
        '[data-agent-native-edit-overlay="paste-position-probe"]',
      ),
    ).toBeNull();
    expect(
      document.head.querySelector(
        'style[data-agent-native-edit-overlay="paste-position-probe-style"]',
      ),
    ).toBeNull();
  });

  it("measures non-pixel margins with the probe after its anchor", () => {
    const container = document.createElement("div");
    container.style.position = "relative";
    const target = document.createElement("div");
    target.style.position = "relative";
    const trailing = document.createElement("span");
    container.append(target, trailing);
    document.body.append(container);

    const observed: Array<{
      positionMatches: boolean;
      marginLeft: string;
      marginTop: string;
    }> = [];
    const restoreGeometry = mockPreparedProbeGeometry(
      container,
      (element) => {
        const probe = element as HTMLElement;
        observed.push({
          positionMatches:
            probe.parentElement === container &&
            probe.previousElementSibling === target &&
            probe.nextElementSibling === trailing,
          marginLeft: probe.style.marginLeft,
          marginTop: probe.style.marginTop,
        });
      },
      testRect(17, 23, 100, 50),
    );

    let measured: ReturnType<typeof measurePreparedCloneVisualOffset>;
    try {
      measured = measurePreparedCloneVisualOffset(
        target,
        '<div style="width:100px;height:50px;margin-left:auto;margin-top:1em;transform:rotate(2deg)">Card</div>',
        {
          placement: "after",
          view: window,
          renderOffset: { x: 0, y: 0 },
        },
      );
    } finally {
      restoreGeometry();
      container.remove();
    }

    expect(measured).toEqual({ x: 17, y: 23 });
    expect(observed).toEqual([
      { positionMatches: true, marginLeft: "auto", marginTop: "1em" },
    ]);
  });

  it("measures an inside-body probe at the final insertion parent", () => {
    const observedParents: Element[] = [];
    const restoreGeometry = mockPreparedProbeGeometry(
      document.body,
      (element) => observedParents.push(element.parentElement!),
      testRect(11, 13, 100, 50),
    );

    let measured: ReturnType<typeof measurePreparedCloneVisualOffset>;
    try {
      measured = measurePreparedCloneVisualOffset(
        document.body,
        '<div style="width:100px;height:50px;margin:0 auto">Card</div>',
        {
          placement: "inside",
          view: window,
          renderOffset: { x: 0, y: 0 },
        },
      );
    } finally {
      restoreGeometry();
    }

    expect(measured).toEqual({ x: 11, y: 13 });
    expect(observedParents).toEqual([document.body]);
  });

  it("prunes matching same-file root styles and preserves descendant snapshots", () => {
    const style = document.createElement("style");
    style.textContent =
      ".same-file-card{width:120px;height:60px;color:rgb(12,34,56);font-family:Arial;transform:scale(1.2);transform-origin:top}.same-file-card span{font-weight:700}";
    document.head.append(style);
    const parent = document.createElement("div");
    parent.style.cssText = "position:relative;width:400px;height:300px";
    const target = document.createElement("div");
    parent.append(target);
    document.body.append(parent);
    const source = document.createElement("div");
    source.className = "same-file-card";
    source.innerHTML = "<span>Text</span>";
    document.body.append(source);

    const rootComputed = window.getComputedStyle(source);
    const childComputed = window.getComputedStyle(source.firstElementChild!);
    const childFontWeight = childComputed.fontWeight;
    const styleSnapshot: PortableStyleSnapshot = {
      version: 1 as const,
      nodes: [
        {
          path: [],
          styles: {
            width: rootComputed.width,
            height: rootComputed.height,
            color: rootComputed.color,
            "font-family": rootComputed.getPropertyValue("font-family"),
            transform: rootComputed.transform,
            transformOrigin: rootComputed.transformOrigin,
            position: "absolute",
            left: "0px",
            top: "0px",
            right: "4px",
            bottom: "5px",
            visibility: "hidden",
            pointerEvents: "none",
          },
        },
        { path: [0], styles: { fontWeight: childFontWeight } },
      ],
    };
    const probeInlineStyles: string[] = [];
    const probeGeometry: string[][] = [];
    const restoreGeometry = mockPreparedProbeGeometry(parent, (element) => {
      probeInlineStyles.push(element.getAttribute("style") ?? "");
      const probe = element as HTMLElement;
      probeGeometry.push([
        probe.style.position,
        probe.style.left,
        probe.style.top,
        probe.style.right,
        probe.style.bottom,
        probe.style.visibility,
        probe.style.pointerEvents,
      ]);
    });
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 1;
        readonly b = 0;
        readonly c = 0;
        readonly d = 1;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );

    let measured: ReturnType<typeof measurePreparedCloneVisualOffset>;
    try {
      measured = measurePreparedCloneVisualOffset(
        target,
        '<div class="same-file-card" data-agent-native-node-id="source"><span>Text</span></div>',
        {
          styleSnapshot,
          preserveSourceAuthoredRootStyles: true,
          view: window,
          renderOffset: { x: 0, y: 0 },
        },
      );
    } finally {
      restoreGeometry();
      parent.remove();
      source.remove();
      style.remove();
    }

    expect(measured).not.toBeNull();
    expect(measured?.styleSnapshot).toEqual({
      version: 1,
      nodes: [
        {
          path: [],
          styles: {
            position: "absolute",
            left: "0px",
            top: "0px",
            right: "4px",
            bottom: "5px",
            visibility: "hidden",
            pointerEvents: "none",
          },
        },
        { path: [0], styles: { fontWeight: childFontWeight } },
      ],
    });
    expect(probeGeometry).toEqual([
      ["absolute", "0px", "0px", "", "", "hidden", "none"],
    ]);
    expect(probeInlineStyles).toHaveLength(1);
    expect(probeInlineStyles[0]).not.toMatch(
      /(?:width|height|color|font-family|transform|transform-origin):/u,
    );
  });

  it("retains a root override when the destination cascade differs", () => {
    const style = document.createElement("style");
    style.textContent =
      ".target-context .inheriting-copy{color:rgb(80,90,100)}";
    document.head.append(style);
    const sourceContext = document.createElement("div");
    sourceContext.className = "source-context";
    const source = document.createElement("div");
    source.className = "inheriting-copy";
    source.style.color = "rgb(12, 34, 56)";
    sourceContext.append(source);
    document.body.append(sourceContext);
    const parent = document.createElement("div");
    parent.className = "target-context";
    parent.style.cssText = "position:relative;width:400px;height:300px";
    const target = document.createElement("div");
    parent.append(target);
    document.body.append(parent);
    const sourceColor = window.getComputedStyle(source).color;
    const probeStyles: string[] = [];
    const restoreGeometry = mockPreparedProbeGeometry(parent, (element) => {
      probeStyles.push((element as HTMLElement).style.color);
    });
    let measured: ReturnType<typeof measurePreparedCloneVisualOffset>;
    try {
      measured = measurePreparedCloneVisualOffset(
        target,
        '<div class="inheriting-copy" data-agent-native-node-id="source">Text</div>',
        {
          styleSnapshot: {
            version: 1,
            nodes: [{ path: [], styles: { color: sourceColor } }],
          },
          preserveSourceAuthoredRootStyles: true,
          view: window,
          renderOffset: { x: 0, y: 0 },
        },
      );
    } finally {
      restoreGeometry();
      parent.remove();
      sourceContext.remove();
      style.remove();
    }

    expect(measured?.styleSnapshot?.nodes).toEqual([
      { path: [], styles: { color: sourceColor } },
    ]);
    expect(probeStyles).toEqual([sourceColor]);
  });

  it("places a scaled layer by its transformed bounds around a percentage origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 2;
        readonly b = 0;
        readonly c = 0;
        readonly d = 2;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:0;top:0;width:100px;height:50px;transform:scale(2);transform-origin:25% 75%">Scaled</div>',
      ],
      { positions: [{ x: 50, y: 40, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.left).toBe("75px");
    expect(clone.style.top).toBe("78px");
  });
});

describe("linked component cloning", () => {
  const designId = "design-components";
  const sourceFileId = "screen-source";
  const source = {
    kind: "design-file" as const,
    designId,
    fileId: sourceFileId,
    filename: "index.html",
  };
  const nestedOverrides = encodeURIComponent(
    JSON.stringify([{ sourceNodeId: "play-label", property: "style:color" }]),
  );
  const outerOverrides = encodeURIComponent(
    JSON.stringify([{ sourceNodeId: "card-copy", property: "style:color" }]),
  );
  const sourceHtml = `<!doctype html><html><body>
    <article data-agent-native-node-id="card-main" data-agent-native-component-id="cmp-card" data-agent-native-component="Card">
      <button data-agent-native-node-id="card-play" data-agent-native-component-ref="cmp-play" data-agent-native-component="PlayButton" data-agent-native-component-overrides="${nestedOverrides}">
        <span data-agent-native-node-id="play-label-instance" data-agent-native-component-source-node-id="play-label">Play</span>
      </button>
      <p data-agent-native-node-id="card-copy" style="color: black">Card</p>
    </article>
    <button data-agent-native-node-id="play-main" data-agent-native-component-id="cmp-play" data-agent-native-component="PlayButton">
      <span data-agent-native-node-id="play-label" style="color: white">Play</span>
    </button>
  </body></html>`;
  const sourceDocument = (content: string) => ({ source, content });
  const findNode = (
    content: string,
    nodeId: string,
    sourceValue: CodeLayerSource = source,
  ) =>
    buildCodeLayerProjection(content, { source: sourceValue }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === nodeId,
    );
  const assertLinksResolve = (
    contents: Array<{ source: CodeLayerSource; content: string }>,
  ) => {
    const analysis = analyzeComponentLinks(
      contents.map(({ source: sourceValue, content }) =>
        buildCodeLayerProjection(content, { source: sourceValue }),
      ),
    );
    expect(analysis.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "cmp-card",
          status: "resolved",
        }),
        expect.objectContaining({
          componentId: "cmp-play",
          status: "resolved",
        }),
      ]),
    );
    expect(analysis.invalidNodes).toEqual([]);
  };

  it("duplicates a main twice, then duplicates a linked reference without losing nested mappings", () => {
    const mainHtml = findNode(sourceHtml, "card-main")?.source;
    expect(mainHtml).toBeTruthy();
    if (!mainHtml) return;
    const mainFragment = sourceHtml.slice(mainHtml.start, mainHtml.end);
    const first = insertClonedHtmlLayers(sourceHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(sourceHtml)],
      },
    });
    expect(first).not.toBeNull();
    if (!first) return;
    const firstProjection = buildCodeLayerProjection(first.content, { source });
    const firstReference = firstProjection.nodes.find(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(firstReference).toBeTruthy();
    if (!firstReference) return;
    const withOverrides = patchCodeLayerNodeAttributes(first.content, [
      {
        node: firstReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: outerOverrides },
      },
    ]);
    expect(withOverrides).not.toBeNull();
    if (!withOverrides) return;
    const second = insertClonedHtmlLayers(withOverrides, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(withOverrides)],
      },
    });
    expect(second).not.toBeNull();
    if (!second) return;

    const afterTwoMains = buildCodeLayerProjection(second.content, { source });
    const cardReferences = afterTwoMains.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(cardReferences).toHaveLength(2);
    const sourceReference = cardReferences[0];
    expect(sourceReference).toBeTruthy();
    if (!sourceReference) return;
    const sourceNestedReference = sourceReference.children[0]
      ? afterTwoMains.nodes.find(
          (node) => node.id === sourceReference.children[0],
        )
      : undefined;
    expect(sourceNestedReference).toBeTruthy();
    if (!sourceNestedReference) return;
    const withNestedOverride = patchCodeLayerNodeAttributes(second.content, [
      {
        node: sourceNestedReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: nestedOverrides },
      },
    ]);
    expect(withNestedOverride).not.toBeNull();
    if (!withNestedOverride) return;
    const cloneSourceProjection = buildCodeLayerProjection(withNestedOverride, {
      source,
    });
    const cloneSourceReference = cloneSourceProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        sourceReference.dataAttributes["data-agent-native-node-id"],
    );
    expect(cloneSourceReference?.source).toBeTruthy();
    if (!cloneSourceReference?.source) return;
    const referenceFragment = withNestedOverride.slice(
      cloneSourceReference.source.start,
      cloneSourceReference.source.end,
    );
    const third = insertClonedHtmlLayers(
      withNestedOverride,
      [referenceFragment],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: source,
          documents: [sourceDocument(withNestedOverride)],
        },
      },
    );
    expect(third).not.toBeNull();
    if (!third) return;

    const finalProjection = buildCodeLayerProjection(third.content, { source });
    const finalReferences = finalProjection.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(finalReferences).toHaveLength(3);
    const clonedReference = finalProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        third.rootNodeIds[0],
    );
    expect(clonedReference?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      outerOverrides,
    );
    const clonedOuterRoot = finalProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        third.rootNodeIds[0],
    );
    const nestedReference = clonedOuterRoot?.children[0]
      ? finalProjection.nodes.find(
          (node) => node.id === clonedOuterRoot.children[0],
        )
      : undefined;
    expect(nestedReference?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      nestedOverrides,
    );
    const nestedLabel = nestedReference?.children[0]
      ? finalProjection.nodes.find(
          (node) => node.id === nestedReference.children[0],
        )
      : undefined;
    expect(nestedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    expect(
      new Set(
        finalReferences.map(
          (node) => node.dataAttributes["data-agent-native-node-id"],
        ),
      ).size,
    ).toBe(3);
    assertLinksResolve([sourceDocument(third.content)]);
  });

  it("links a main clone across Screens in the same Design and refuses cross-Design identity", () => {
    const mainSpan = findNode(sourceHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = sourceHtml.slice(mainSpan.start, mainSpan.end);
    const targetSource = {
      kind: "design-file" as const,
      designId,
      fileId: "screen-target",
      filename: "target.html",
    };
    const targetHtml =
      '<!doctype html><html><body><div id="anchor"></div></body></html>';
    const moved = insertClonedHtmlLayers(targetHtml, [mainFragment], {
      targetSelectors: ["#anchor"],
      placement: "inside",
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource,
        documents: [
          sourceDocument(sourceHtml),
          { source: targetSource, content: targetHtml },
        ],
      },
    });
    expect(moved).not.toBeNull();
    if (!moved) return;
    const targetProjection = buildCodeLayerProjection(moved.content, {
      source: targetSource,
    });
    expect(
      targetProjection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] ===
          moved.rootNodeIds[0],
      )?.dataAttributes[COMPONENT_REF_ATTR],
    ).toBe("cmp-card");
    assertLinksResolve([
      sourceDocument(sourceHtml),
      { source: targetSource, content: moved.content },
    ]);

    const wrongDesignSource = { ...targetSource, designId: "other-design" };
    expect(
      insertClonedHtmlLayers(targetHtml, [mainFragment], {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: wrongDesignSource,
          documents: [
            sourceDocument(sourceHtml),
            { source: wrongDesignSource, content: targetHtml },
          ],
        },
      }),
    ).toBeNull();
  });

  it("links a canonical component nested inside an ordinary container clone", () => {
    const containerHtml = sourceHtml
      .replace(
        '<article data-agent-native-node-id="card-main"',
        '<section data-agent-native-node-id="group-main"><article data-agent-native-node-id="card-main"',
      )
      .replace(
        '    </article>\n    <button data-agent-native-node-id="play-main"',
        '    </article></section>\n    <button data-agent-native-node-id="play-main"',
      );
    const groupSpan = findNode(containerHtml, "group-main")?.source;
    expect(groupSpan).toBeTruthy();
    if (!groupSpan) return;
    const groupFragment = containerHtml.slice(groupSpan.start, groupSpan.end);
    const duplicated = insertClonedHtmlLayers(containerHtml, [groupFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(containerHtml)],
      },
    });
    expect(duplicated).not.toBeNull();
    if (!duplicated) return;

    const projection = buildCodeLayerProjection(duplicated.content, { source });
    const cloneGroup = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        duplicated.rootNodeIds[0],
    );
    const clonedCard = cloneGroup?.children[0]
      ? projection.nodes.find((node) => node.id === cloneGroup.children[0])
      : undefined;
    expect(clonedCard?.dataAttributes[COMPONENT_ID_ATTR]).toBeUndefined();
    expect(clonedCard?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-card");
    const originalCard = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "card-main",
    );
    expect(originalCard?.dataAttributes[COMPONENT_ID_ATTR]).toBe("cmp-card");
    const clonedPlay = clonedCard?.children[0]
      ? projection.nodes.find((node) => node.id === clonedCard.children[0])
      : undefined;
    expect(clonedPlay?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-play");
    expect(clonedPlay?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "card-play",
    );
    expect(
      clonedPlay?.dataAttributes[COMPONENT_OVERRIDES_ATTR],
    ).toBeUndefined();
    const clonedLabel = clonedPlay?.children[0]
      ? projection.nodes.find((node) => node.id === clonedPlay.children[0])
      : undefined;
    expect(clonedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    assertLinksResolve([sourceDocument(duplicated.content)]);
  });

  it("preserves a linked reference nested inside an ordinary container clone", () => {
    const mainSpan = findNode(sourceHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = sourceHtml.slice(mainSpan.start, mainSpan.end);
    const withReference = insertClonedHtmlLayers(sourceHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(sourceHtml)],
      },
    });
    expect(withReference).not.toBeNull();
    if (!withReference) return;
    const beforeWrap = buildCodeLayerProjection(withReference.content, {
      source,
    });
    const referenceRoot = beforeWrap.nodes.find(
      (node) =>
        node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card" &&
        node.dataAttributes["data-agent-native-node-id"] ===
          withReference.rootNodeIds[0],
    );
    expect(referenceRoot?.source).toBeTruthy();
    if (!referenceRoot?.source) return;
    const withOverrides = patchCodeLayerNodeAttributes(withReference.content, [
      {
        node: referenceRoot,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: outerOverrides },
      },
    ]);
    expect(withOverrides).not.toBeNull();
    if (!withOverrides) return;
    const overriddenProjection = buildCodeLayerProjection(withOverrides, {
      source,
    });
    const overriddenReference = overriddenProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        withReference.rootNodeIds[0],
    );
    expect(overriddenReference?.source).toBeTruthy();
    if (!overriddenReference?.source) return;
    const nestedReference = overriddenReference.children[0]
      ? overriddenProjection.nodes.find(
          (node) => node.id === overriddenReference.children[0],
        )
      : undefined;
    expect(nestedReference).toBeTruthy();
    if (!nestedReference) return;
    const withNestedOverride = patchCodeLayerNodeAttributes(withOverrides, [
      {
        node: nestedReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: nestedOverrides },
      },
    ]);
    expect(withNestedOverride).not.toBeNull();
    if (!withNestedOverride) return;
    const finalBeforeWrap = buildCodeLayerProjection(withNestedOverride, {
      source,
    });
    const finalOverriddenReference = finalBeforeWrap.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        withReference.rootNodeIds[0],
    );
    expect(finalOverriddenReference?.source).toBeTruthy();
    if (!finalOverriddenReference?.source) return;
    const referenceHtml = withNestedOverride.slice(
      finalOverriddenReference.source.start,
      finalOverriddenReference.source.end,
    );
    const wrappedHtml =
      withNestedOverride.slice(0, finalOverriddenReference.source.start) +
      `<aside data-agent-native-node-id="ordinary-ref-group">${referenceHtml}</aside>` +
      withNestedOverride.slice(finalOverriddenReference.source.end);
    const groupFragment = `<aside data-agent-native-node-id="ordinary-ref-group">${referenceHtml}</aside>`;
    const duplicated = insertClonedHtmlLayers(wrappedHtml, [groupFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(wrappedHtml)],
      },
    });
    expect(duplicated).not.toBeNull();
    if (!duplicated) return;

    const projection = buildCodeLayerProjection(duplicated.content, { source });
    const cloneGroup = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        duplicated.rootNodeIds[0],
    );
    const clonedCard = cloneGroup?.children[0]
      ? projection.nodes.find((node) => node.id === cloneGroup.children[0])
      : undefined;
    expect(clonedCard?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-card");
    expect(clonedCard?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      outerOverrides,
    );
    const clonedPlay = clonedCard?.children[0]
      ? projection.nodes.find((node) => node.id === clonedCard.children[0])
      : undefined;
    expect(clonedPlay?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-play");
    expect(clonedPlay?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      nestedOverrides,
    );
    const clonedLabel = clonedPlay?.children[0]
      ? projection.nodes.find((node) => node.id === clonedPlay.children[0])
      : undefined;
    expect(clonedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    assertLinksResolve([sourceDocument(duplicated.content)]);
  });

  it("propagates a nested main edit through the cloned parent reference", () => {
    const propagationHtml = sourceHtml.replace(
      ` data-agent-native-component-overrides="${nestedOverrides}"`,
      "",
    );
    const mainSpan = findNode(propagationHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = propagationHtml.slice(mainSpan.start, mainSpan.end);
    const cloned = insertClonedHtmlLayers(propagationHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(propagationHtml)],
      },
    });
    expect(cloned).not.toBeNull();
    if (!cloned) return;

    const propagation = applyComponentPropertyEdit({
      documents: [sourceDocument(cloned.content)],
      target: { fileId: sourceFileId, nodeId: "play-label" },
      edit: { kind: "style", property: "color", value: "red" },
    });
    expect(propagation.status).toBe("updated");
    if (propagation.status !== "updated") return;
    const finalContent = propagation.changes.find(
      (change) => change.fileId === sourceFileId,
    )?.after;
    expect(finalContent).toBeTruthy();
    if (!finalContent) return;
    const finalProjection = buildCodeLayerProjection(finalContent, { source });
    const playReferences = finalProjection.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-play",
    );
    expect(playReferences).toHaveLength(2);
    for (const reference of playReferences) {
      const instanceLabel = finalProjection.nodes.find(
        (node) =>
          node.parentId === reference.id &&
          node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] === "play-label",
      );
      expect(instanceLabel?.style.color).toBe("red");
    }
  });

  it("refuses a component subtree with ambiguous copied durable IDs", () => {
    const ambiguousHtml = sourceHtml.replace(
      'data-agent-native-node-id="card-copy"',
      'data-agent-native-node-id="card-play"',
    );
    const mainSpan = findNode(ambiguousHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const result = insertClonedHtmlLayers(
      "<!doctype html><html><body></body></html>",
      [ambiguousHtml.slice(mainSpan.start, mainSpan.end)],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: source,
          documents: [sourceDocument(ambiguousHtml)],
        },
      },
    );
    expect(result).toBeNull();
  });

  it("refuses a clone batch when a linked reference cannot be resolved", () => {
    const unresolvedContent = `<!doctype html><html><body>
      <section data-agent-native-node-id="unresolved" data-agent-native-component-ref="missing-component">Source</section>
    </body></html>`;
    const result = insertClonedHtmlLayers(
      unresolvedContent,
      [
        '<div data-agent-native-node-id="ordinary">Ordinary clone</div>',
        '<section data-agent-native-node-id="unresolved" data-agent-native-component-ref="missing-component">Unresolved linked clone</section>',
      ],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId, sourceFileId],
          targetSource: source,
          documents: [sourceDocument(unresolvedContent)],
        },
      },
    );

    expect(result).toBeNull();
  });
});

function parseFragment(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<template>${html}</template>`,
    "text/html",
  );
  const element = doc.querySelector("template")?.content.firstElementChild;
  if (!element) throw new Error("Expected one cloned element");
  return element;
}

describe("prepareClonedHtmlLayersForLiveInsert", () => {
  it("rejects a failed snapshot sentinel atomically", () => {
    const layerHtmls = [
      `<div data-agent-native-node-id=\"one\">One</div>`,
      `<div data-agent-native-node-id=\"two\">Two</div>`,
    ];
    const liveResult = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      layerHtmls,
      { styleSnapshots: [undefined, null] },
    );
    const storedResult = insertClonedHtmlLayers(
      "<!doctype html><html><body></body></html>",
      layerHtmls,
      { styleSnapshots: [undefined, null] },
    );

    expect(liveResult).toBeNull();
    expect(storedResult).toBeNull();
  });

  it("preserves the human runtime layer name before clone ids replace authored ids", () => {
    const html =
      '<section id="runtime-panel" data-component-name="RuntimePanel">Panel</section>';
    const enriched = preserveClipboardLayerName(html, "Runtime Panel");
    const root = parseFragment(enriched);

    expect(root.getAttribute("data-agent-native-layer-name")).toBe(
      "Runtime Panel",
    );
    expect(
      preserveClipboardLayerName(
        '<section data-agent-native-layer-name="Authored">Panel</section>',
        "Runtime Panel",
      ),
    ).toContain('data-agent-native-layer-name="Authored"');
  });

  it("keeps a duplicated text-derived name dynamic and an authored name fixed", () => {
    for (const authoredName of [null, "Headline"]) {
      const heading = `<h1 data-agent-native-node-id="title"${authoredName ? ` data-agent-native-layer-name="${authoredName}"` : ""}>First title</h1>`;
      const prepared = prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
        heading,
      ]);
      expect(prepared).not.toBeNull();
      const clone = parseFragment(prepared!.htmlFragments[0]!);
      clone.textContent = "Second title";
      expect(clone.getAttribute("data-agent-native-layer-name")).toBe(
        authoredName,
      );
      const projection = buildCodeLayerProjection(clone.outerHTML);
      expect(
        projection.nodes.find((node) => node.tag === "h1")?.layerName,
      ).toBe(authoredName ?? "Second title");
    }
  });

  it("clones a subtree with fresh node ids and remapped authored id references", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section id="card" data-agent-native-node-id="root" data-agent-native-runtime-component-id="runtime-component-card" data-agent-native-runtime-instance-id="root">
          <label for="field" data-agent-native-node-id="label">Name</label>
          <input id="field" aria-labelledby="card" data-agent-native-node-id="input">
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    const label = clone.querySelector("label")!;
    const input = clone.querySelector("input")!;
    expect(clone.getAttribute("data-agent-native-node-id")).not.toBe("root");
    expect(clone.getAttribute("data-agent-native-runtime-component-id")).toBe(
      "runtime-component-card",
    );
    expect(clone.getAttribute("data-agent-native-runtime-instance-id")).toBe(
      clone.getAttribute("data-agent-native-node-id"),
    );
    expect(label.getAttribute("data-agent-native-node-id")).not.toBe("label");
    expect(input.getAttribute("data-agent-native-node-id")).not.toBe("input");
    expect(clone.id).not.toBe("card");
    expect(input.id).not.toBe("field");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-labelledby")).toBe(clone.id);
    expect(result!.rootNodeIds).toEqual([
      clone.getAttribute("data-agent-native-node-id"),
    ]);
    expect(result!.nodeIdMap.get("root")).toBe(
      clone.getAttribute("data-agent-native-node-id"),
    );
    expect(result!.nodeIdMap.get("input")).toBe(
      input.getAttribute("data-agent-native-node-id"),
    );
  });

  it("keeps clone names stable when authored ids are re-keyed", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
      `<section id="runtime-panel" data-agent-native-node-id="root"><div>Panel</div></section>`,
      `<div data-agent-native-node-id="unnamed"></div>`,
    ]);

    expect(result).not.toBeNull();
    expect(
      result!.htmlFragments.map(
        (html) => buildCodeLayerProjection(html).nodes[0]?.layerName,
      ),
      // "Runtime Panel" is an explicit runtime name; the unnamed plain <div>
      // has no id/class/aria-label so layerNameFor() falls back to the tag
      // ("Frame") — the clone must derive the SAME tag fallback, never the
      // literal "Copy" (a duplicate keeps the identical name).
    ).toEqual(["Runtime Panel", "Frame"]);
    expect(result!.htmlFragments[0]).not.toContain('id="runtime-panel"');
    expect(result!.htmlFragments[1]).not.toContain(
      'data-agent-native-layer-name="Copy"',
    );
  });

  it("drops the Figma/Fusion source identity so deleting a copy cannot resolve to the original", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section data-loc="Card.tsx:12:4" data-builder-id="blk-1">
          <h3 data-loc="Card.tsx:13:6">Title</h3>
          <p data-code-layer-id="layer-9" data-layer-id="l-2">Body</p>
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    for (const attribute of [
      "data-loc",
      "data-builder-id",
      "data-code-layer-id",
      "data-layer-id",
    ]) {
      expect(clone.hasAttribute(attribute)).toBe(false);
      expect(clone.querySelector(`[${attribute}]`)).toBeNull();
    }
    const nodeIds = [clone, ...Array.from(clone.querySelectorAll("*"))].map(
      (node) => node.getAttribute("data-agent-native-node-id"),
    );
    expect(nodeIds.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it("preserves sanitized provenance and computed portable styles", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<article
          data-agent-native-node-id="card"
          data-source-framework="react"
          data-source-file="src/Card.tsx"
          data-source-line="42"
          data-source-column="7"
          data-component-name="Card"
          style="display:flex;color:rgb(1, 2, 3)"
        ><span
          data-agent-native-node-id="title"
          data-source-file="src/Card.tsx"
          data-source-line="42"
          data-source-column="7"
          data-component-name="CardTitle"
          data-source-owner-file="src/App.tsx"
          data-source-owner-line="18"
          data-source-owner-column="5"
          data-source-owner-component="Card"
          data-source-owner-key="featured"
        >Title</span></article>`,
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "card",
            nodes: [
              {
                sourceId: "card",
                path: [],
                styles: {
                  display: "grid",
                  "background-color": "rgb(4, 5, 6)",
                },
              },
              {
                sourceId: "title",
                path: [0],
                styles: { "font-weight": "700" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-source-framework")).toBe("react");
    expect(clone.getAttribute("data-source-file")).toBe("src/Card.tsx");
    expect(clone.getAttribute("data-source-line")).toBe("42");
    expect(clone.getAttribute("data-source-column")).toBe("7");
    expect(clone.getAttribute("data-component-name")).toBe("Card");
    const title = clone.querySelector("span");
    expect(title?.getAttribute("data-source-file")).toBe("src/Card.tsx");
    expect(title?.getAttribute("data-source-line")).toBe("42");
    expect(title?.getAttribute("data-source-column")).toBe("7");
    expect(title?.getAttribute("data-component-name")).toBe("CardTitle");
    expect(title?.getAttribute("data-source-owner-file")).toBe("src/App.tsx");
    expect(title?.getAttribute("data-source-owner-line")).toBe("18");
    expect(title?.getAttribute("data-source-owner-column")).toBe("5");
    expect(title?.getAttribute("data-source-owner-component")).toBe("Card");
    expect(title?.getAttribute("data-source-owner-key")).toBe("featured");
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
    expect((clone as HTMLElement).style.display).toBe("grid");
    expect((clone as HTMLElement).style.backgroundColor).toBe("rgb(4, 5, 6)");
    expect((clone.querySelector("span") as HTMLElement).style.fontWeight).toBe(
      "700",
    );
  });

  it("preserves group identity when cloning a legacy generated wrapper", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="an-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "group",
            nodes: [
              {
                sourceId: "group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBe("true");
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("preserves legacy generated group identity without a style snapshot", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
      '<div data-agent-native-node-id="an-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
    ]);

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBe("true");
  });

  it("marks a copied authored Group as a clone, not a legacy generated wrapper", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="group" data-agent-native-layer-name="Group"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "group",
            nodes: [
              {
                sourceId: "group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBeNull();
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("does not promote an older copied Group with preserved styles", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="copy-old-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "copy-old-group",
            nodes: [
              {
                sourceId: "copy-old-group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBeNull();
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("returns the destination URL byte-for-byte instead of turning it into HTML", () => {
    const destination = "http://localhost:5173/a%20b?x=%3Cmain%3E#section";
    const result = prepareClonedHtmlLayersForLiveInsert(destination, [
      '<div data-agent-native-node-id="source">Safe</div>',
    ]);

    expect(result?.destinationContent).toBe(destination);
    expect(result?.destinationContent).not.toContain("<!DOCTYPE");
    expect(
      prepareClonedHtmlLayersForLiveInsert(
        "<!doctype html><html><body></body></html>",
        ['<div data-agent-native-node-id="source">Safe</div>'],
      ),
    ).toBeNull();
  });

  it("returns one safe root per entry and strips active markup", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<div data-agent-native-node-id="one" onclick="attack()">
          One<script>attack()</script>
        </div>`,
        `<button data-agent-native-node-id="two" style="position:absolute;left:9px;top:10px" formaction="javascript:attack()" autofocus>
          Two<iframe></iframe>
        </button>`,
      ],
      {
        positions: [{ x: 12.4, y: 25.6 }, null],
        stripRootPosition: true,
      },
    );

    expect(result?.htmlFragments).toHaveLength(2);
    expect(result?.rootNodeIds).toHaveLength(2);
    expect(new Set(result?.rootNodeIds).size).toBe(2);
    const first = parseFragment(result!.htmlFragments[0]!);
    const second = parseFragment(result!.htmlFragments[1]!);
    expect((first as HTMLElement).style.position).toBe("absolute");
    expect((first as HTMLElement).style.left).toBe("12px");
    expect((first as HTMLElement).style.top).toBe("26px");
    expect(first.hasAttribute("onclick")).toBe(false);
    expect(first.querySelector("script")).toBeNull();
    expect(second.hasAttribute("formaction")).toBe(false);
    expect(second.hasAttribute("autofocus")).toBe(false);
    expect(second.querySelector("iframe")).toBeNull();
    expect((second as HTMLElement).style.position).toBe("");
    expect((second as HTMLElement).style.left).toBe("");
    expect((second as HTMLElement).style.top).toBe("");
  });

  it("rejects an active element used as the fragment root", () => {
    expect(
      prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
        '<script data-agent-native-node-id="script">attack()</script>',
      ]),
    ).toBeNull();
  });
});
