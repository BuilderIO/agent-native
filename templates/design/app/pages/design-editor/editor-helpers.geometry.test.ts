// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { measuredPositionValue } from "@/components/design/edit-panel/position-layout-properties";
import type { ElementInfo } from "@/components/design/types";

import { withMeasuredGeometry } from "./editor-helpers";

const frames: HTMLIFrameElement[] = [];

beforeEach(() => {
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
  vi.unstubAllGlobals();
});

function mockRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }) as DOMRect;
  element.getClientRects = () =>
    [{ ...rect, left: rect.x, top: rect.y }] as unknown as DOMRectList;
}

describe("withMeasuredGeometry clipboard placement", () => {
  it("returns live containing-block coordinates for a zero-size target", () => {
    const frame = document.createElement("iframe");
    frame.dataset.designPreviewIframe = "";
    frame.dataset.screenIframeId = "screen-1";
    document.body.append(frame);
    frames.push(frame);

    const preview = frame.contentDocument!;
    const parent = preview.createElement("div");
    parent.style.cssText = "position:relative;width:300px;height:200px";
    mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
    const target = preview.createElement("button");
    target.dataset.agentNativeNodeId = "target";
    target.style.cssText =
      "position:static;left:45px;top:57px;width:0;height:0";
    mockRect(target, { x: 145, y: 257, width: 0, height: 0 });
    parent.append(target);
    preview.body.append(parent);

    const measured = withMeasuredGeometry(
      {
        tagName: "button",
        selector: '[data-agent-native-node-id="target"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 0, height: 0 },
        isFlexChild: false,
        isFlexContainer: false,
      } satisfies ElementInfo,
      "screen-1",
      { measureAbsoluteSiblingVisualOrigin: true },
    );

    expect(measured.absoluteSiblingVisualOrigin).toEqual({ x: 45, y: 57 });
  });

  it("measures from an explicitly supplied board preview iframe", () => {
    const frame = document.createElement("iframe");
    frame.dataset.designPreviewIframe = "";
    document.body.append(frame);
    frames.push(frame);

    const preview = frame.contentDocument!;
    const parent = preview.createElement("div");
    parent.style.cssText = "position:relative;width:300px;height:200px";
    mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
    const target = preview.createElement("button");
    target.dataset.agentNativeNodeId = "board-target";
    target.style.cssText =
      "position:static;left:45px;top:57px;width:80px;height:40px";
    mockRect(target, { x: 145, y: 257, width: 80, height: 40 });
    parent.append(target);
    preview.body.append(parent);

    const measured = withMeasuredGeometry(
      {
        tagName: "button",
        selector: '[data-agent-native-node-id="board-target"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 80, height: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      } satisfies ElementInfo,
      "board-file",
      {
        measureAbsoluteSiblingVisualOrigin: true,
        previewIframe: frame,
      },
    );

    expect(measured.absoluteSiblingVisualOrigin).toEqual({ x: 45, y: 57 });
  });

  it("refreshes geometry through a source selector past an injected sibling", () => {
    const frame = document.createElement("iframe");
    frame.dataset.designPreviewIframe = "";
    frame.dataset.screenIframeId = "screen-1";
    document.body.append(frame);
    frames.push(frame);

    const preview = frame.contentDocument!;
    const parent = preview.createElement("div");
    parent.style.cssText = "position:relative;width:300px;height:200px";
    mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
    const overlay = preview.createElement("button");
    overlay.setAttribute("data-agent-native-edit-overlay", "");
    overlay.style.cssText = "width:10px;height:10px";
    mockRect(overlay, { x: 110, y: 210, width: 10, height: 10 });
    const target = preview.createElement("button");
    target.dataset.agentNativeNodeId = "target";
    target.style.cssText =
      "position:static;left:45px;top:57px;width:80px;height:40px";
    mockRect(target, { x: 145, y: 257, width: 80, height: 40 });
    parent.append(overlay, target);
    preview.body.append(parent);

    const measured = withMeasuredGeometry(
      {
        tagName: "button",
        selector:
          "source-equivalent:v1:body > div:nth-of-type(1) > button:nth-of-type(1)",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 0, height: 0 },
        isFlexChild: false,
        isFlexContainer: false,
      } satisfies ElementInfo,
      "screen-1",
      { measureAbsoluteSiblingVisualOrigin: true },
    );

    expect(measured.boundingRect).toEqual({
      x: 145,
      y: 257,
      width: 80,
      height: 40,
    });
    expect(measured.absoluteSiblingVisualOrigin).toEqual({ x: 45, y: 57 });
  });
});

describe("withMeasuredGeometry during a move drag", () => {
  function mountDraggedLayer(options: { moveActive: boolean }) {
    const frame = document.createElement("iframe");
    frame.dataset.designPreviewIframe = "";
    frame.dataset.screenIframeId = "screen-1";
    document.body.append(frame);
    frames.push(frame);

    const preview = frame.contentDocument!;
    const parent = preview.createElement("div");
    parent.style.cssText = "position:relative;width:1200px;height:760px";
    mockRect(parent, { x: 0, y: 0, width: 1200, height: 760 });
    const target = preview.createElement("div");
    target.dataset.agentNativeNodeId = "ellipse";
    // The bridge's first move tick already wrote the dragged position.
    target.style.cssText =
      "position:absolute;left:340px;top:420px;width:120px;height:120px";
    mockRect(target, { x: 340, y: 420, width: 120, height: 120 });
    parent.append(target);
    preview.body.append(parent);
    (
      frame.contentWindow as Window & {
        __agentNativeLayerMoveActive?: boolean;
      }
    ).__agentNativeLayerMoveActive = options.moveActive;

    // The selection the bridge posted on pointerdown, before the layer moved.
    const selection: ElementInfo = {
      tagName: "div",
      selector: '[data-agent-native-node-id="ellipse"]',
      sourceId: "ellipse",
      classes: [],
      computedStyles: { position: "absolute", left: "320px", top: "400px" },
      boundingRect: { x: 320, y: 400, width: 120, height: 120 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    return withMeasuredGeometry(selection, "screen-1");
  }

  it("measures the dragged layer where its selection says it started", () => {
    const measured = mountDraggedLayer({ moveActive: true });

    expect(measured.boundingRect).toEqual({
      x: 320,
      y: 400,
      width: 120,
      height: 120,
    });
    // Baseline plus the bridge's live offset reads the live position, once.
    const live = { left: "360px", top: "440px" };
    expect(measuredPositionValue(measured, "x", live)).toBe("360px");
    expect(measuredPositionValue(measured, "y", live)).toBe("440px");
    // Esc restores the layer and clears the live offset.
    expect(measuredPositionValue(measured, "x")).toBe("320px");
    expect(measuredPositionValue(measured, "y")).toBe("400px");
  });

  it("measures the layer where it renders when no move drag runs", () => {
    const measured = mountDraggedLayer({ moveActive: false });

    expect(measured.boundingRect).toEqual({
      x: 340,
      y: 420,
      width: 120,
      height: 120,
    });
  });
});
