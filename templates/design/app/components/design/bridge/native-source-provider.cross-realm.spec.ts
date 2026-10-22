// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { createNativeSceneProvider } from "./native-source-provider";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("captures adopted Rectangle Fill output in the complete scene", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const frame = document.createElement("iframe");
  frame.setAttribute("data-agent-native-edit-overlay", "");
  document.body.append(frame);
  const foreign = frame.contentDocument!;
  const target = foreign.createElement("div");
  expect(target instanceof HTMLElement).toBe(false);
  target.setAttribute("data-agent-native-node-id", "same-target");
  target.setAttribute("data-an-native-fill-instance", "base-fill");
  target.setAttribute("data-an-native-layer-instance", "final-layer");
  target.setAttribute("data-an-native-authored-opacity", "0.5");
  target.setAttribute("data-an-native-fill-suppressed", "");
  target.setAttribute("data-an-native-layer-suppressed", "");
  const fill = document.createElement("canvas");
  fill.setAttribute("data-an-native-canvas", "base-fill");
  fill.setAttribute("data-an-native-presentation", "");
  const layer = document.createElement("canvas");
  layer.setAttribute("data-an-native-canvas", "final-layer");
  layer.setAttribute("data-an-native-presentation", "");
  layer.setAttribute("data-an-native-layer-opacity-owner", "receiver");
  const backdrop = document.createElement("canvas");
  backdrop.width = 100;
  backdrop.height = 80;
  backdrop.setAttribute("data-an-native-canvas", "own-backdrop");
  backdrop.setAttribute("data-an-native-presentation", "");
  backdrop.setAttribute("data-an-native-backdrop-presentation", "");
  backdrop.setAttribute(
    "data-an-native-backdrop-receiver-node-id",
    "same-target",
  );
  backdrop.setAttribute("data-an-native-authored-opacity", "1");
  document.body.append(backdrop, target, fill, layer);
  for (const element of [
    document.documentElement,
    document.body,
    target,
    backdrop,
    fill,
    layer,
  ])
    Object.defineProperty(element, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  const boxes = new Map<Element, DOMRect>([
    [document.documentElement, new DOMRect(0, 0, 400, 300)],
    [document.body, new DOMRect(0, 0, 400, 300)],
    [target, new DOMRect(10, 20, 100, 80)],
    [backdrop, new DOMRect(10, 20, 100, 80)],
    [fill, new DOMRect(10, 20, 100, 80)],
    [layer, new DOMRect(5, 10, 120, 100)],
  ]);
  for (const [element] of boxes) {
    Object.defineProperties(element, {
      offsetWidth: {
        configurable: true,
        get: () => boxes.get(element)?.width ?? 0,
      },
      offsetHeight: {
        configurable: true,
        get: () => boxes.get(element)?.height ?? 0,
      },
      offsetLeft: {
        configurable: true,
        get: () => boxes.get(element)?.x ?? 0,
      },
      offsetTop: {
        configurable: true,
        get: () => boxes.get(element)?.y ?? 0,
      },
    });
  }
  Object.defineProperty(target, "getBoundingClientRect", {
    value: () => boxes.get(target),
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return boxes.get(this) ?? new DOMRect(0, 0, 0, 0);
    },
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        imageRendering: "auto",
        display: "block",
        visibility: "visible",
        opacity: element === target ? "0" : "1",
        position: element instanceof HTMLCanvasElement ? "absolute" : "static",
        transform: "none",
        transformOrigin: "0px 0px",
        translate: "none",
        rotate: "none",
        scale: "none",
        perspective: "none",
        transformStyle: "flat",
        isolation: "auto",
        zIndex: "auto",
        order: "0",
        mixBlendMode: "normal",
        filter: "none",
        backdropFilter: "none",
        backgroundImage: "none",
        backgroundColor: "rgba(0, 0, 0, 0)",
        boxShadow: "none",
        outlineStyle: "none",
        clipPath: "none",
        maskImage: "none",
        overflowX: "visible",
        overflowY: "visible",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        borderLeftWidth: "0px",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        paddingLeft: "0px",
        width: "100px",
        height: "80px",
        boxSizing: "border-box",
        getPropertyValue: () => "0px",
        content: "none",
      }) as unknown as CSSStyleDeclaration,
  );

  const provider = createNativeSceneProvider(document.body, "layer")!;
  try {
    const records = await provider.readScene();
    expect(
      records
        .filter((record) => record.nativeInstanceId)
        .map((record) => ({ id: record.nativeInstanceId, rect: record.rect })),
    ).toEqual([
      { id: "final-layer", rect: { x: 5, y: 10, width: 120, height: 100 } },
    ]);
  } finally {
    provider.dispose();
  }
});
