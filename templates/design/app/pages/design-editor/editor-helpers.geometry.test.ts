// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { withMeasuredGeometry } from "./editor-helpers";

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
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
});
