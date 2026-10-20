// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { embeddedContentOffsetStyle } from "@/components/design/design-canvas/embedded-frame";

import {
  measureAbsoluteSiblingVisualOrigin,
  measurePositionCoordinateContext,
  positionCoordinateRenderOffsetForWindow,
} from "./position-coordinate-context";

const cleanup: Element[] = [];

afterEach(() => {
  cleanup.splice(0).forEach((element) => element.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function append(element: Element): void {
  document.body.appendChild(element);
  cleanup.push(element);
}

function requiredRenderOffset(view: Window) {
  const offset = positionCoordinateRenderOffsetForWindow(view);
  if (!offset) throw new Error("Expected a readable render offset");
  return offset;
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

function mockSingleClientRect(element: Element): void {
  element.getClientRects = () =>
    [{ x: 0, y: 0, width: 1, height: 1 }] as unknown as DOMRectList;
}

function stubMatrixReadOnly(): void {
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      readonly is2D = true;
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly e: number;
      readonly f: number;

      constructor(value: string) {
        const parts = value
          .slice(value.indexOf("(") + 1, value.lastIndexOf(")"))
          .split(",")
          .map(Number);
        [this.a, this.b, this.c, this.d, this.e, this.f] = parts;
      }
    },
  );
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

  it("treats an absent offset marker as a known zero offset", () => {
    const iframe = document.createElement("iframe");
    append(iframe);

    expect(
      positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
    ).toEqual({ x: 0, y: 0 });
  });

  it.each(["invalid", "", " "])(
    "returns unknown for unreadable offset %j",
    (attribute) => {
      const iframe = document.createElement("iframe");
      append(iframe);
      const style = iframe.contentDocument!.createElement("style");
      style.setAttribute("data-agent-native-content-offset", "");
      style.setAttribute("data-agent-native-content-offset-x", attribute);
      style.setAttribute("data-agent-native-content-offset-y", attribute);
      style.textContent =
        "body > [data-agent-native-node-id]{translate:var(--board-offset);}";
      iframe.contentDocument!.head.appendChild(style);

      expect(
        positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
      ).toBeNull();
    },
  );

  it("returns unknown when reading a same-origin offset marker throws", () => {
    const iframe = document.createElement("iframe");
    append(iframe);
    const doc = iframe.contentDocument!;
    const originalQuerySelector = doc.querySelector.bind(doc);
    vi.spyOn(doc, "querySelector").mockImplementation((selector) => {
      if (selector === "style[data-agent-native-content-offset]") {
        throw new DOMException("Offset style is unavailable", "SecurityError");
      }
      return originalQuerySelector(selector);
    });

    expect(
      positionCoordinateRenderOffsetForWindow(iframe.contentWindow!),
    ).toBeNull();
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
      requiredRenderOffset(window),
    );
    style.setAttribute("data-agent-native-content-offset-x", "-30");
    style.setAttribute("data-agent-native-content-offset-y", "40");
    style.textContent =
      "body > [data-agent-native-node-id]{translate:-30px 40px;}";
    const second = measurePositionCoordinateContext(
      root,
      window,
      requiredRenderOffset(window),
    );

    expect(first.positionContainingBlockOrigin).toEqual({ x: 10, y: 20 });
    expect(second.positionContainingBlockOrigin).toEqual({ x: -30, y: 40 });
  });
});

describe("measureAbsoluteSiblingVisualOrigin", () => {
  it("measures an inline target whose used dimensions are auto", () => {
    const parent = document.createElement("div");
    parent.style.cssText =
      "position:relative;width:300px;height:200px;box-sizing:border-box";
    mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
    mockSingleClientRect(parent);
    append(parent);
    const target = document.createElement("span");
    target.style.cssText = "display:inline;width:auto;height:auto";
    mockRect(target, { x: 145, y: 257, width: 80, height: 20 });
    target.getClientRects = () =>
      [target.getBoundingClientRect()] as unknown as DOMRectList;
    parent.appendChild(target);
    expect(
      measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
    ).toEqual({ x: 45, y: 57 });
  });

  it("measures every wrapped inline fragment through a skewed parent", () => {
    stubMatrixReadOnly();
    const parent = document.createElement("div");
    parent.style.cssText =
      "position:relative;width:300px;height:200px;box-sizing:border-box;transform:matrix(1, 1, 1, 2, 0, 0)";
    mockRect(parent, { x: 100, y: 200, width: 500, height: 700 });
    mockSingleClientRect(parent);
    append(parent);
    const target = document.createElement("span");
    target.style.cssText = "display:inline;width:auto;height:auto";
    mockRect(target, { x: 202, y: 359, width: 100, height: 131 });
    target.getClientRects = () =>
      [
        { x: 202, y: 359, width: 100, height: 120 },
        { x: 210, y: 400, width: 70, height: 90 },
      ] as unknown as DOMRectList;
    parent.appendChild(target);
    expect(
      measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
    ).toEqual({ x: 20, y: 57 });
  });

  it("reports unknown when fragment dimensions cannot be recovered uniquely", () => {
    stubMatrixReadOnly();
    const parent = document.createElement("div");
    parent.style.cssText =
      "position:relative;width:300px;height:200px;box-sizing:border-box;transform:matrix(1, 1, -1, 1, 0, 0)";
    mockRect(parent, { x: -100, y: 200, width: 500, height: 500 });
    mockSingleClientRect(parent);
    append(parent);
    const target = document.createElement("span");
    target.style.cssText = "display:inline;width:auto;height:auto";
    mockRect(target, { x: 68, y: 302, width: 100, height: 100 });
    target.getClientRects = () =>
      [target.getBoundingClientRect()] as unknown as DOMRectList;
    parent.appendChild(target);
    expect(
      measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
    ).toBeNull();
  });

  it.each([
    [
      "throws",
      () => {
        throw new DOMException("Quad read denied", "SecurityError");
      },
    ],
    ["returns no quads", () => []],
  ] as const)(
    "returns unknown when a target quad read %s",
    (_result, readQuads) => {
      const parent = document.createElement("div");
      parent.style.cssText =
        "position:relative;width:300px;height:200px;box-sizing:border-box";
      mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
      mockSingleClientRect(parent);
      append(parent);

      const target = document.createElement("div");
      target.style.cssText =
        "position:absolute;left:45px;top:57px;width:20px;height:10px;box-sizing:border-box";
      mockRect(target, { x: 145, y: 257, width: 20, height: 10 });
      mockSingleClientRect(target);
      Object.defineProperty(target, "getBoxQuads", {
        configurable: true,
        value: readQuads,
      });
      parent.appendChild(target);

      expect(
        measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
      ).toBeNull();
    },
  );

  it.each([
    [
      "throws",
      () => {
        throw new DOMException("Quad read denied", "SecurityError");
      },
    ],
    ["returns no quads", () => []],
  ] as const)(
    "returns unknown when a containing-block padding quad read %s",
    (_result, readQuads) => {
      const parent = document.createElement("div");
      parent.style.cssText =
        "position:relative;width:300px;height:200px;box-sizing:border-box";
      mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
      mockSingleClientRect(parent);
      Object.defineProperty(parent, "getBoxQuads", {
        configurable: true,
        value: readQuads,
      });
      append(parent);

      const target = document.createElement("div");
      target.style.cssText =
        "position:absolute;left:45px;top:57px;width:20px;height:10px;box-sizing:border-box";
      mockRect(target, { x: 145, y: 257, width: 20, height: 10 });
      mockSingleClientRect(target);
      parent.appendChild(target);

      expect(
        measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
      ).toBeNull();
    },
  );

  it("normalizes a board root against the injected board render offset", () => {
    const root = document.createElement("div");
    root.setAttribute("data-agent-native-node-id", "screen-root");
    root.style.cssText =
      "position:absolute;left:0;top:0;width:800px;height:600px;box-sizing:border-box";
    mockRect(root, { x: 4096, y: 2048, width: 800, height: 600 });
    mockSingleClientRect(root);
    append(root);

    expect(
      measureAbsoluteSiblingVisualOrigin(root, window, {
        x: 4096,
        y: 2048,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("maps every target corner through a skewed parent and its own transform", () => {
    stubMatrixReadOnly();
    const parent = document.createElement("div");
    parent.style.cssText =
      "position:relative;width:300px;height:200px;box-sizing:border-box;transform:matrix(0, 1, -1, 1, 0, 0)";
    mockRect(parent, { x: -100, y: 200, width: 200, height: 500 });
    mockSingleClientRect(parent);
    append(parent);

    const target = document.createElement("div");
    target.style.cssText =
      "position:absolute;left:40px;top:100px;width:30px;height:20px;box-sizing:border-box;transform:matrix(0, 1, -1, 0, 0, 0)";
    mockRect(target, { x: -30, y: 320, width: 30, height: 50 });
    mockSingleClientRect(target);
    parent.appendChild(target);

    expect(
      measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
    ).toEqual({ x: 20, y: 100 });
  });

  it("keeps a finite origin when the target has no rendered area", () => {
    stubMatrixReadOnly();
    const parent = document.createElement("div");
    parent.style.cssText =
      "position:relative;width:300px;height:200px;box-sizing:border-box";
    mockRect(parent, { x: 100, y: 200, width: 300, height: 200 });
    mockSingleClientRect(parent);
    append(parent);

    const target = document.createElement("div");
    target.style.cssText =
      "position:absolute;left:45px;top:57px;width:0;height:0;box-sizing:border-box";
    mockRect(target, { x: 145, y: 257, width: 0, height: 0 });
    mockSingleClientRect(target);
    parent.appendChild(target);

    expect(
      measureAbsoluteSiblingVisualOrigin(target, window, { x: 0, y: 0 }),
    ).toEqual({ x: 45, y: 57 });
  });
});
