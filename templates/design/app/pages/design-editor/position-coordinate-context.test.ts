// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { embeddedContentOffsetStyle } from "@/components/design/design-canvas/embedded-frame";

import {
  measurePositionCoordinateContext,
  positionCoordinateRenderOffsetForWindow,
} from "./position-coordinate-context";

const cleanup: Element[] = [];

afterEach(() => {
  cleanup.splice(0).forEach((element) => element.remove());
});

function append(element: Element): void {
  document.body.appendChild(element);
  cleanup.push(element);
}

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
}

describe("measurePositionCoordinateContext board render offset", () => {
  it("aligns document-root Position origins with an internally translated board root", () => {
    const root = document.createElement("div");
    root.setAttribute("data-agent-native-node-id", "screen-root");
    root.style.position = "absolute";
    root.style.left = "0px";
    root.style.top = "0px";
    mockRect(root, { x: 4096, y: 2048, width: 800, height: 600 });
    append(root);

    const context = measurePositionCoordinateContext(root, window, {
      x: 4096,
      y: 2048,
    });

    expect(context.positionReferenceRect).toMatchObject({ x: 4096, y: 2048 });
    expect(context.positionContainingBlockOrigin).toEqual({ x: 4096, y: 2048 });
    expect(root.getBoundingClientRect()).toMatchObject({ x: 4096, y: 2048 });
  });

  it("keeps frame and containing-block origins already inside the translated root", () => {
    const root = document.createElement("div");
    root.setAttribute("data-agent-native-node-id", "screen-root");
    root.style.position = "relative";
    mockRect(root, { x: 4096, y: 2048, width: 800, height: 600 });
    append(root);

    const frame = document.createElement("div");
    frame.setAttribute("data-an-primitive", "frame");
    frame.style.position = "relative";
    mockRect(frame, { x: 4116, y: 2068, width: 400, height: 300 });
    root.appendChild(frame);

    const target = document.createElement("div");
    target.style.position = "absolute";
    frame.appendChild(target);

    const context = measurePositionCoordinateContext(target, window, {
      x: 4096,
      y: 2048,
    });

    expect(context.positionReferenceRect).toMatchObject({ x: 4116, y: 2068 });
    expect(context.positionContainingBlockOrigin).toEqual({ x: 4116, y: 2068 });
  });

  it("does not apply board offsets to ordinary screens or unshifted body children", () => {
    const ordinaryRoot = document.createElement("div");
    ordinaryRoot.setAttribute("data-agent-native-node-id", "screen-root");
    mockRect(ordinaryRoot, { x: 0, y: 0, width: 800, height: 600 });
    append(ordinaryRoot);

    const ordinaryContext = measurePositionCoordinateContext(
      ordinaryRoot,
      window,
      { x: 0, y: 0 },
    );
    expect(ordinaryContext.positionReferenceRect).toMatchObject({ x: 0, y: 0 });
    expect(ordinaryContext.positionContainingBlockOrigin).toEqual({
      x: 0,
      y: 0,
    });

    const unshifted = document.createElement("div");
    mockRect(unshifted, { x: 0, y: 0, width: 100, height: 50 });
    append(unshifted);
    const unshiftedContext = measurePositionCoordinateContext(
      unshifted,
      window,
      { x: 4096, y: 2048 },
    );
    expect(unshiftedContext.positionReferenceRect).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(unshiftedContext.positionContainingBlockOrigin).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("reads the live offset metadata paired with the applied iframe CSS", () => {
    const iframe = document.createElement("iframe");
    append(iframe);
    iframe.contentDocument!.head.innerHTML = embeddedContentOffsetStyle(
      4096.4,
      2047.8,
    );

    expect(
      positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
    ).toEqual({
      x: 4096,
      y: 2048,
    });

    const offsetStyle = iframe.contentDocument!.querySelector("style")!;
    offsetStyle.textContent =
      "body > [data-agent-native-node-id]{translate:-12px 34px;}";
    offsetStyle.setAttribute("data-agent-native-content-offset-x", "-12");
    offsetStyle.setAttribute("data-agent-native-content-offset-y", "34");
    expect(
      positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
    ).toEqual({ x: -12, y: 34 });
  });

  it("reads legacy CSS text and maps the offset through body scale", () => {
    const iframe = document.createElement("iframe");
    append(iframe);
    iframe.contentDocument!.head.innerHTML =
      "<style data-agent-native-content-offset>body > [data-agent-native-node-id]{translate:5px 7px;}</style>";
    iframe.contentDocument!.body.style.setProperty("scale", "2");

    expect(
      positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
    ).toEqual({ x: 10, y: 14 });
  });

  it("remeasures the same selected root after the live offset changes", () => {
    const root = document.createElement("div");
    root.setAttribute("data-agent-native-node-id", "screen-root");
    root.style.position = "absolute";
    mockRect(root, { x: 10, y: 20, width: 800, height: 600 });
    append(root);

    const style = document.createElement("style");
    style.setAttribute("data-agent-native-content-offset", "");
    style.setAttribute("data-agent-native-content-offset-x", "10");
    style.setAttribute("data-agent-native-content-offset-y", "20");
    style.textContent =
      "body > [data-agent-native-node-id]{translate:10px 20px;}";
    document.head.appendChild(style);
    cleanup.push(style);

    const first = measurePositionCoordinateContext(
      root,
      window,
      positionCoordinateRenderOffsetForWindow(window),
    );
    style.setAttribute("data-agent-native-content-offset-x", "-30");
    style.setAttribute("data-agent-native-content-offset-y", "40");
    style.textContent =
      "body > [data-agent-native-node-id]{translate:-30px 40px;}";
    const second = measurePositionCoordinateContext(
      root,
      window,
      positionCoordinateRenderOffsetForWindow(window),
    );

    expect(first.positionContainingBlockOrigin).toEqual({ x: 10, y: 20 });
    expect(second.positionContainingBlockOrigin).toEqual({ x: -30, y: 40 });
  });
});
