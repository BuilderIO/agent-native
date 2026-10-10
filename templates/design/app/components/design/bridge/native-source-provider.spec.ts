// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyNativeComputedOverflowClip } from "../../../../shared/native-source-clip-plan";
import { planNativeSourceComposition } from "../../../../shared/native-source-composition-tree";
import {
  planNativeCaptureRoi,
  setNativeCaptureRoi,
} from "./native-capture-roi";
import {
  assertDomSiblingOrder,
  applyNativeCaptureOverflowClip,
  CachedLeaf,
  clipCanvasToOwnTextOverflow,
  cloneNativeTextFlow,
  createNativeSceneProvider,
  nativePresentationVisible,
  nativeTargetOverflowInsets,
  paintNativeTextFlow,
  sourceClipPlan,
  transformedSourcePaintIsContiguous,
  traceNativeRoundedBoxPath,
} from "./native-source-provider";
import { planNativeImageSampling } from "./native-source-sampling";

const previousResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.overflow = "";
  globalThis.ResizeObserver = previousResizeObserver;
  vi.restoreAllMocks();
});

const mutationTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("source capture density", () => {
  it("invalidates a nearby fractional DPR change that changes tall raster height", () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    document.body.append(target);
    const provider = createNativeSceneProvider(target, "fill");
    expect(provider).not.toBeNull();
    try {
      provider!.setDensity(1.6008);
      provider!.setDensity(1.6);
      expect(Math.ceil(2000 * 1.6008)).not.toBe(Math.ceil(2000 * 1.6));
      expect((provider as unknown as { density: number }).density).toBe(1.6);
    } finally {
      provider?.dispose();
    }
  });
});

describe("expanded HTML capture clip", () => {
  it("serializes a readable computed margin even when CSS enumeration omits it", () => {
    const style = {
      length: 0,
      overflowX: "clip",
      overflowY: "clip",
      getPropertyValue: (name: string) =>
        name === "overflow-clip-margin" ? "content-box 3.25px" : "",
    } as unknown as CSSStyleDeclaration;
    const overflow = classifyNativeComputedOverflowClip(style);
    expect(overflow).toEqual({ ok: true, edge: "content", outset: 3.25 });
    if (!overflow.ok) throw new Error("The test clip must be readable.");
    const clone = document.createElement("div");
    applyNativeCaptureOverflowClip(clone, overflow);
    const xml = new XMLSerializer().serializeToString(clone);
    expect(xml).toContain("overflow: clip");
    expect(xml).toContain("overflow-clip-margin: content-box 3.25px");
  });
});

describe("native presentation visibility", () => {
  it("excludes a layer-consumed fill under an opacity-zero host while retaining standalone fills", () => {
    const host = document.createElement("div");
    const consumedFill = document.createElement("canvas");
    const finalLayer = document.createElement("canvas");
    host.style.opacity = "0";
    host.append(consumedFill);
    document.body.append(host, finalLayer);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          opacity: element === host ? host.style.opacity : "1",
          visibility: "visible",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 10, 100, 80),
    );
    const viewport = { width: 200, height: 150 };
    expect(nativePresentationVisible(consumedFill, viewport)).toBe(false);
    expect(nativePresentationVisible(finalLayer, viewport)).toBe(true);
    host.style.opacity = "1";
    expect(nativePresentationVisible(consumedFill, viewport)).toBe(true);
  });
});

describe("same-target Fill and Layer source ownership", () => {
  it("uses the Fill as Layer input and the final Layer in full-scene capture", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
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
    document.body.append(target, fill, layer);
    const boxes = new Map<Element, DOMRect>([
      [document.documentElement, new DOMRect(0, 0, 400, 300)],
      [document.body, new DOMRect(0, 0, 400, 300)],
      [target, new DOMRect(10, 20, 100, 80)],
      [fill, new DOMRect(10, 20, 100, 80)],
      [layer, new DOMRect(5, 10, 120, 100)],
    ]);
    for (const [element, box] of boxes) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: box.width },
        offsetHeight: { configurable: true, value: box.height },
        offsetLeft: { configurable: true, value: box.x },
        offsetTop: { configurable: true, value: box.y },
      });
    }
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
          position:
            element instanceof HTMLCanvasElement ? "absolute" : "static",
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
          getPropertyValue: () => "0px",
          content: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    const layerSource = createNativeSceneProvider(target, "layer");
    const fullScene = createNativeSceneProvider(document.body, "layer");
    try {
      const input = await layerSource!.readScene();
      expect(
        input
          .filter((record) => record.nativeInstanceId)
          .map((record) => record.nativeInstanceId),
      ).toEqual(["base-fill"]);
      expect(input[0]).toMatchObject({
        rect: { x: 0, y: 0, width: 100, height: 80 },
        isolationPath: [
          expect.objectContaining({ kind: "opacity", opacity: 0.5 }),
        ],
      });
      const output = await fullScene!.readScene();
      expect(
        output
          .filter((record) => record.nativeInstanceId)
          .map((record) => record.nativeInstanceId),
      ).toEqual(["final-layer"]);
      expect(output[0]).toMatchObject({
        rect: { x: 5, y: 10, width: 120, height: 100 },
        isolationPath: [],
      });
    } finally {
      layerSource?.dispose();
      fullScene?.dispose();
    }
  });
});

describe("scene-suppressed native presentation visibility", () => {
  it("uses only validated authored opacity for a scene-suppressed ancestor", () => {
    const container = document.createElement("main");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-an-native-backdrop-presentation", "");
    canvas.setAttribute("data-an-native-authored-opacity", "1");
    canvas.style.opacity = "0";
    container.setAttribute("data-an-native-scene-suppressed", "");
    container.setAttribute("data-an-native-authored-opacity", "1");
    container.append(canvas);
    document.body.append(container);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 10, 50, 50),
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          visibility: "visible",
          opacity: element === canvas || element === container ? "0" : "1",
        }) as CSSStyleDeclaration,
    );
    const viewport = { width: 100, height: 100 };
    expect(nativePresentationVisible(canvas, viewport)).toBe(true);
    container.removeAttribute("data-an-native-authored-opacity");
    expect(() => nativePresentationVisible(canvas, viewport)).toThrowError(
      expect.objectContaining({ code: "source-opacity-invalid" }),
    );
    container.setAttribute("data-an-native-authored-opacity", "bad");
    expect(() => nativePresentationVisible(canvas, viewport)).toThrowError(
      expect.objectContaining({ code: "source-opacity-invalid" }),
    );
    container.setAttribute("data-an-native-authored-opacity", "0");
    expect(nativePresentationVisible(canvas, viewport)).toBe(false);
  });
});

describe("backdrop presentation sources", () => {
  it("records empty receivers in the full scene and samples only earlier backdrop output", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const firstReceiver = document.createElement("div");
    const secondReceiver = document.createElement("div");
    firstReceiver.setAttribute("data-agent-native-node-id", "first-receiver");
    secondReceiver.setAttribute("data-agent-native-node-id", "second-receiver");
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    for (const [canvas, id] of [
      [first, "first-glass"],
      [second, "second-glass"],
    ] as const) {
      canvas.width = 100;
      canvas.height = 80;
      canvas.setAttribute("data-an-native-canvas", id);
      canvas.setAttribute("data-an-native-presentation", "");
      canvas.setAttribute("data-an-native-backdrop-presentation", "");
      canvas.setAttribute(
        "data-an-native-backdrop-receiver-node-id",
        canvas === first ? "first-receiver" : "second-receiver",
      );
      canvas.setAttribute("data-an-native-authored-opacity", "1");
      canvas.style.opacity = "0";
    }
    document.body.append(firstReceiver, secondReceiver);
    const sceneCanvas = document.createElement("canvas");
    sceneCanvas.setAttribute("data-an-native-scene-presentation", "");
    sceneCanvas.setAttribute("data-an-native-presentation", "");
    sceneCanvas.width = 400;
    sceneCanvas.height = 300;
    document.body.prepend(sceneCanvas);
    firstReceiver.before(first);
    secondReceiver.before(second);
    const boxes = new Map<Element, DOMRect>([
      [document.documentElement, new DOMRect(0, 0, 400, 300)],
      [document.body, new DOMRect(0, 0, 400, 300)],
      [sceneCanvas, new DOMRect(0, 0, 400, 300)],
      [firstReceiver, new DOMRect(10, 10, 100, 80)],
      [first, new DOMRect(10, 10, 100, 80)],
      [secondReceiver, new DOMRect(30, 20, 100, 80)],
      [second, new DOMRect(30, 20, 100, 80)],
    ]);
    for (const [element, box] of boxes) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: box.width },
        offsetHeight: { configurable: true, value: box.height },
        offsetLeft: { configurable: true, value: box.x },
        offsetTop: { configurable: true, value: box.y },
      });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return boxes.get(this) ?? new DOMRect(0, 0, 0, 0);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: element === document.head ? "none" : "block",
          visibility: "visible",
          opacity:
            element.hasAttribute("data-an-native-scene-suppressed") ||
            (element instanceof HTMLCanvasElement &&
              element.hasAttribute("data-an-native-backdrop-presentation"))
              ? "0"
              : "1",
          position:
            element instanceof HTMLCanvasElement ? "absolute" : "static",
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
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    expect(nativePresentationVisible(first, { width: 400, height: 300 })).toBe(
      true,
    );
    first.removeAttribute("data-an-native-authored-opacity");
    expect(nativePresentationVisible(first, { width: 400, height: 300 })).toBe(
      false,
    );
    first.setAttribute("data-an-native-authored-opacity", "1");
    const full = createNativeSceneProvider(document.documentElement, "layer");
    expect(full?.needsContinuousFrames()).toBe(false);
    const firstSource = createNativeSceneProvider(
      firstReceiver,
      "backdrop",
      undefined,
      first,
    );
    const secondSource = createNativeSceneProvider(
      secondReceiver,
      "backdrop",
      undefined,
      second,
    );
    try {
      const fullRecords = await full!.readScene();
      expect(fullRecords.some((record) => record.node === sceneCanvas)).toBe(
        false,
      );
      expect(
        fullRecords
          .filter((record) => record.kind === "native")
          .map((record) => record.nativeInstanceId),
      ).toEqual(["first-glass", "second-glass"]);
      expect(await firstSource!.readScene()).toEqual([]);
      firstReceiver.setAttribute("data-an-native-authored-opacity", "1");
      firstReceiver.setAttribute("data-an-native-scene-suppressed", "");
      secondReceiver.setAttribute("data-an-native-authored-opacity", "1");
      secondReceiver.setAttribute("data-an-native-scene-suppressed", "");
      expect(
        (await full!.readScene())
          .filter((record) => record.kind === "native")
          .map((record) => record.nativeInstanceId),
      ).toEqual(["first-glass", "second-glass"]);
      const previous = await secondSource!.readScene();
      expect(
        previous
          .filter((record) => record.kind === "native")
          .map((record) => record.nativeInstanceId),
      ).toEqual(["first-glass"]);
      const authoredBefore = full!.authoredSourceEpoch?.();
      const added = document.createElement("div");
      added.textContent = "later authored sibling";
      document.body.append(added);
      await mutationTurn();
      expect(full!.authoredSourceEpoch?.()).toBeGreaterThan(authoredBefore!);
      added.remove();
      await mutationTurn();
      const stable = full!.authoredSourceEpoch?.();
      const runtimeCanvas = document.createElement("canvas");
      runtimeCanvas.setAttribute("data-an-native-presentation", "");
      document.body.append(runtimeCanvas);
      await mutationTurn();
      expect(full!.authoredSourceEpoch?.()).toBe(stable);
      runtimeCanvas.remove();
    } finally {
      full?.dispose();
      firstSource?.dispose();
      secondSource?.dispose();
    }
  });
});

describe("native cached source captures", () => {
  it("attributes capture invalidations without charging native canvas motion", async () => {
    const callbacks: { resize?: ResizeObserverCallback } = {};
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    const textNode = document.createTextNode("initial");
    const nativeCanvas = document.createElement("canvas");
    nativeCanvas.setAttribute("data-an-native-canvas", "effect-1");
    host.append(textNode, nativeCanvas);
    document.body.append(host);
    let width = 8;
    Object.defineProperties(host, {
      offsetWidth: { get: () => width },
      offsetHeight: { value: 8 },
    });
    let density = 1;
    let captures = 0;
    let wakes = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      host,
      () => {
        captures += 1;
      },
      () => density,
      async (_element, canvas) => {
        canvas.width = 8 * density;
        canvas.height = 8 * density;
      },
      () => {
        wakes += 1;
      },
      (reason) => reasons.push(reason),
    );
    try {
      await leaf.read();
      await leaf.read();
      expect(captures).toBe(1);
      expect(reasons).toEqual(["initial"]);
      nativeCanvas.style.width = "20px";
      await mutationTurn();
      expect(reasons).toEqual(["initial"]);
      host.style.transform = "translateX(8px)";
      await mutationTurn();
      expect(wakes).toBeGreaterThan(1);
      expect(reasons).toEqual(["initial"]);
      textNode.textContent = "changed";
      await mutationTurn();
      await leaf.read();
      expect(captures).toBe(2);
      expect(reasons[reasons.length - 1]).toBe("content");
      callbacks.resize?.([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("content");
      width = 10;
      callbacks.resize?.([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("resize");
      density = 2;
      await leaf.read();
      expect(reasons[reasons.length - 1]).toBe("density");
      expect(captures).toBe(3);
    } finally {
      leaf.dispose();
    }
  });

  it("ignores initial and unchanged ResizeObserver delivery but invalidates a changed raster extent", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    let width = 8;
    let height = 8;
    Object.defineProperties(host, {
      offsetWidth: { get: () => width },
      offsetHeight: { get: () => height },
    });
    let captures = 0;
    const reasons: string[] = [];
    const makeLeaf = () =>
      new CachedLeaf(
        host,
        () => {
          captures += 1;
        },
        () => 2,
        async (_element, canvas) => {
          canvas.width = width * 2;
          canvas.height = height * 2;
        },
        () => {},
        (reason) => reasons.push(reason),
      );
    let leaf = makeLeaf();
    try {
      callbacks[0]([], {} as ResizeObserver);
      expect(reasons).toEqual([]);
      await leaf.read();
      expect(reasons).toEqual(["initial"]);
      callbacks[0]([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial"]);
      await leaf.read();
      expect(captures).toBe(1);
      width = 9;
      callbacks[0]([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial", "resize"]);
      await leaf.read();
      expect(captures).toBe(2);
      callbacks[0]([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial", "resize", "dimensions"]);
      leaf.dispose();
      leaf = makeLeaf();
      callbacks[1]([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial", "resize", "dimensions"]);
      await leaf.read();
      callbacks[1]([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("initial");
      height = 10;
      callbacks[1]([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("resize");
    } finally {
      leaf.dispose();
    }
  });

  it("invalidates a fractional SVG resize even when the raster extent rounds to the same pixels", async () => {
    let resize: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const source = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    document.body.append(source);
    let width = 8.1;
    vi.spyOn(source, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, width, 8),
    );
    Object.defineProperty(source, "getBBox", {
      value: () => new DOMRect(0, 0, width, 8),
    });
    let captures = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      source,
      () => {
        captures += 1;
      },
      () => 2,
      async (_element, canvas) => {
        canvas.width = 18;
        canvas.height = 16;
      },
      () => {},
      (reason) => reasons.push(reason),
    );
    try {
      await leaf.read();
      expect(captures).toBe(1);
      expect(reasons).toEqual(["initial"]);
      resize?.([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial"]);
      width = 8.2;
      resize?.([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial", "resize"]);
      await leaf.read();
      expect(captures).toBe(2);
      expect(reasons).toEqual(["initial", "resize", "dimensions"]);
    } finally {
      leaf.dispose();
    }
  });

  it("invalidates a fractional HTML content-box change with an unchanged offset extent", async () => {
    let resize: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperties(host, {
      offsetWidth: { value: 8 },
      offsetHeight: { value: 8 },
    });
    let logicalWidth = 8.1;
    const originalComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      element === host
        ? ({
            width: `${logicalWidth}px`,
            height: "8px",
            boxSizing: "content-box",
            paddingLeft: "0px",
            paddingRight: "0px",
            paddingTop: "0px",
            paddingBottom: "0px",
            borderLeftWidth: "0px",
            borderRightWidth: "0px",
            borderTopWidth: "0px",
            borderBottomWidth: "0px",
          } as CSSStyleDeclaration)
        : originalComputedStyle(element),
    );
    let captures = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      host,
      () => {
        captures += 1;
      },
      () => 2,
      async (_element, canvas) => {
        canvas.width = 16;
        canvas.height = 16;
      },
      () => {},
      (reason) => reasons.push(reason),
    );
    try {
      await leaf.read();
      expect(reasons).toEqual(["initial"]);
      logicalWidth = 8.2;
      resize?.([], {} as ResizeObserver);
      expect(reasons).toEqual(["initial", "resize"]);
      await leaf.read();
      expect(captures).toBe(2);
      expect(reasons).toEqual(["initial", "resize", "dimensions"]);
    } finally {
      leaf.dispose();
    }
  });

  it("reuses an HTML raster when only its transformed viewport bounds move", async () => {
    let resize: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    host.style.width = "8px";
    host.style.height = "8px";
    document.body.append(host);
    Object.defineProperties(host, {
      offsetWidth: { value: 8 },
      offsetHeight: { value: 8 },
    });
    let transformedWidth = 8;
    vi.spyOn(host, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, transformedWidth, 8),
    );
    let captures = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      host,
      () => {
        captures += 1;
      },
      () => 2,
      async (_element, canvas) => {
        canvas.width = 16;
        canvas.height = 16;
      },
      () => {},
      (reason) => reasons.push(reason),
    );
    try {
      await leaf.read();
      expect(captures).toBe(1);
      transformedWidth = 12;
      resize?.([], {} as ResizeObserver);
      await leaf.read();
      expect(captures).toBe(1);
      expect(reasons).toEqual(["initial"]);
    } finally {
      leaf.dispose();
    }
  });

  it("reports an unreadable SVG content box and recovers after a valid measurement", async () => {
    let resize: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const source = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    document.body.append(source);
    vi.spyOn(source, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 8, 8),
    );
    let measurement: "throw" | "invalid" | "valid" = "throw";
    Object.defineProperty(source, "getBBox", {
      value: () => {
        if (measurement === "throw") throw new Error("layout unavailable");
        if (measurement === "invalid") return { width: Number.NaN, height: 8 };
        return new DOMRect(0, 0, 8, 8);
      },
    });
    let captures = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      source,
      () => {
        captures += 1;
      },
      () => 1,
      async (_element, canvas) => {
        canvas.width = 8;
        canvas.height = 8;
      },
      () => {},
      (reason) => reasons.push(reason),
    );
    try {
      await expect(leaf.read()).rejects.toMatchObject({
        code: "source-svg-size",
      });
      expect(captures).toBe(0);
      measurement = "valid";
      await leaf.read();
      expect(captures).toBe(1);
      measurement = "invalid";
      resize?.([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("resize");
      await expect(leaf.read()).rejects.toMatchObject({
        code: "source-svg-size",
      });
      measurement = "throw";
      await expect(leaf.read()).rejects.toMatchObject({
        code: "source-svg-size",
      });
      measurement = "valid";
      await leaf.read();
      expect(captures).toBe(2);
    } finally {
      leaf.dispose();
    }
  });

  it("accepts a readable empty SVG box only with a visible viewport", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const source = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    document.body.append(source);
    vi.spyOn(source, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 8, 8),
    );
    Object.defineProperty(source, "getBBox", {
      value: () => new DOMRect(0, 0, 0, 0),
    });
    const leaf = new CachedLeaf(
      source,
      () => {},
      () => 1,
      async (_element, canvas) => {
        canvas.width = 8;
        canvas.height = 8;
      },
    );
    try {
      await expect(leaf.read()).resolves.toBeInstanceOf(HTMLCanvasElement);
    } finally {
      leaf.dispose();
    }
  });

  it("keeps blank computed box edges at zero but rejects unreadable CSS geometry", async () => {
    let resize: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperties(host, {
      offsetWidth: { value: 8 },
      offsetHeight: { value: 8 },
    });
    let padding = "";
    let computedWidth = "8px";
    const originalComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      element === host
        ? ({
            width: computedWidth,
            height: "8px",
            boxSizing: "content-box",
            paddingLeft: padding,
            paddingRight: "",
            paddingTop: "",
            paddingBottom: "",
            borderLeftWidth: "",
            borderRightWidth: "",
            borderTopWidth: "",
            borderBottomWidth: "",
          } as CSSStyleDeclaration)
        : originalComputedStyle(element),
    );
    let captures = 0;
    const reasons: string[] = [];
    const leaf = new CachedLeaf(
      host,
      () => {
        captures += 1;
      },
      () => 1,
      async (_element, canvas) => {
        canvas.width = 8;
        canvas.height = 8;
      },
      () => {},
      (reason) => reasons.push(reason),
    );
    try {
      await leaf.read();
      expect(captures).toBe(1);
      padding = "NaNpx";
      resize?.([], {} as ResizeObserver);
      expect(reasons[reasons.length - 1]).toBe("resize");
      await expect(leaf.read()).rejects.toMatchObject({
        code: "source-invalid-box",
      });
      padding = "0px";
      computedWidth = "Infinitypx";
      await expect(leaf.read()).rejects.toMatchObject({
        code: "source-invalid-box",
      });
      computedWidth = "8px";
      await leaf.read();
      expect(captures).toBe(2);
    } finally {
      leaf.dispose();
    }
  });

  it("observes omitted chrome attributes without invalidating the authored root", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    document.documentElement.setAttribute(
      "data-an-native-source-idle-observer",
      "",
    );
    const chrome = document.createElement("div");
    chrome.setAttribute("data-agent-native-editor-chrome-host", "true");
    const handle = document.createElement("span");
    chrome.append(handle);
    const authored = document.createElement("div");
    authored.setAttribute("data-agent-native-node-id", "authored");
    document.documentElement.append(chrome);
    document.body.append(authored);
    const observations: Array<{
      name: string;
      withinBody: boolean;
      omitted: boolean;
      oldValue: string | null;
      newValue: string | null;
    }> = [];
    const reasons: string[] = [];
    let wakes = 0;
    const leaf = new CachedLeaf(
      document.documentElement,
      () => {},
      () => 1,
      async () => {},
      () => {
        wakes += 1;
      },
      (reason) => reasons.push(reason),
      (observation) => observations.push(observation),
    );
    try {
      handle.style.display = "none";
      await mutationTurn();
      expect(observations[observations.length - 1]).toMatchObject({
        name: "style",
        withinBody: false,
        omitted: true,
        oldValue: null,
        newValue: "display: none;",
      });
      expect(reasons).toEqual([]);
      expect(wakes).toBe(0);
      authored.style.fontWeight = "bold";
      await mutationTurn();
      expect(observations[observations.length - 1]).toMatchObject({
        name: "style",
        withinBody: true,
        omitted: false,
      });
      expect(reasons).toEqual(["attributes"]);
      expect(wakes).toBe(1);
    } finally {
      leaf.dispose();
      chrome.remove();
      document.documentElement.removeAttribute(
        "data-an-native-source-idle-observer",
      );
    }
  });

  it("ignores omitted subtree and chrome-only child changes, but retains authored and mixed changes", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const chrome = document.createElement("div");
    chrome.setAttribute("data-agent-native-editor-chrome-host", "true");
    const caret = document.createElement("span");
    caret.textContent = "cursor";
    chrome.append(caret);
    document.documentElement.append(chrome);
    const bodyReasons: string[] = [];
    const rootReasons: string[] = [];
    let authoredStyle: HTMLStyleElement | null = null;
    const bodyLeaf = new CachedLeaf(
      document.body,
      () => {},
      () => 1,
      async () => {},
      () => {},
      (reason) => bodyReasons.push(reason),
    );
    const rootLeaf = new CachedLeaf(
      document.documentElement,
      () => {},
      () => 1,
      async () => {},
      () => {},
      (reason) => rootReasons.push(reason),
    );
    try {
      const overlay = document.createElement("span");
      overlay.setAttribute("data-agent-native-edit-overlay", "");
      overlay.textContent = "selection";
      document.body.append(overlay);
      await mutationTurn();
      overlay.firstChild!.textContent = "caret";
      caret.firstChild!.textContent = "cursor 2";
      await mutationTurn();
      overlay.remove();
      await mutationTurn();
      expect(bodyReasons).toEqual([]);
      expect(rootReasons).toEqual([]);

      const anotherChrome = document.createElement("div");
      anotherChrome.setAttribute("data-agent-native-editor-chrome", "");
      document.documentElement.append(anotherChrome);
      await mutationTurn();
      anotherChrome.remove();
      await mutationTurn();
      expect(rootReasons).toEqual([]);

      const mixedOverlay = document.createElement("span");
      mixedOverlay.setAttribute("data-agent-native-edit-overlay", "");
      const authored = document.createElement("span");
      authored.textContent = "authored";
      document.body.append(mixedOverlay, authored);
      await mutationTurn();
      expect(bodyReasons).toEqual(["content"]);
      expect(rootReasons).toEqual(["content"]);
      authored.firstChild!.textContent = "changed";
      await mutationTurn();
      expect(bodyReasons).toEqual(["content", "content"]);
      expect(rootReasons).toEqual(["content", "content"]);
      authoredStyle = document.createElement("style");
      document.head.append(authoredStyle);
      await mutationTurn();
      expect(rootReasons).toEqual(["content", "content", "content"]);
    } finally {
      bodyLeaf.dispose();
      rootLeaf.dispose();
      authoredStyle?.remove();
      chrome.remove();
    }
  });

  it("attributes generic media-background changes only while root diagnostics are opted in", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    const media = document.createElement("canvas");
    media.width = 40;
    media.height = 30;
    target.append(media);
    document.body.append(target);
    for (const element of [target, media]) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: 40 },
        offsetHeight: { configurable: true, value: 30 },
      });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this === target || this === media
          ? new DOMRect(0, 0, 40, 30)
          : new DOMRect(0, 0, 100, 100);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          visibility: "visible",
          opacity: "1",
          position: "static",
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
          // guard:allow-raw-color — this authored media paint verifies the media-background leaf.
          backgroundColor:
            element === media ? "rgb(12, 24, 36)" : "transparent",
          backgroundClip: "border-box",
          objectFit: "fill",
          objectPosition: "50% 50%",
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
          getPropertyValue: () => "0px",
          content: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(
      document.createElement("canvas"),
    );
    const provider = createNativeSceneProvider(target, "layer");
    try {
      await provider!.readScene();
      media.setAttribute("data-authored-probe", "before-opt-in");
      await mutationTurn();
      let background = provider!
        .diagnosticSnapshot()
        .leaves.find((leaf) => leaf.kind === "media-background");
      expect(background?.observedAttributes).toEqual([]);
      document.documentElement.setAttribute(
        "data-an-native-source-idle-observer",
        "",
      );
      media.setAttribute("data-authored-probe", "after-opt-in");
      await mutationTurn();
      background = provider!
        .diagnosticSnapshot()
        .leaves.find((leaf) => leaf.kind === "media-background");
      expect(background?.observedAttributes).toEqual([
        expect.objectContaining({
          targetTag: "canvas",
          name: "data-authored-probe",
          oldValue: "before-opt-in",
          newValue: "after-opt-in",
        }),
      ]);
    } finally {
      provider?.dispose();
      document.documentElement.removeAttribute(
        "data-an-native-source-idle-observer",
      );
    }
  });

  it("settles static sources but wakes for transformed media and video playback", async () => {
    const target = document.createElement("div");
    const image = document.createElement("img");
    target.append(image);
    document.body.append(target);
    let dirty = 0;
    const provider = createNativeSceneProvider(target, "layer", () => {
      dirty += 1;
    });
    expect(provider).not.toBeNull();
    try {
      expect(provider!.needsContinuousFrames()).toBe(false);
      provider!.invalidate();
      expect(dirty).toBe(1);
      target.style.transform = "translateX(12px)";
      await mutationTurn();
      expect(dirty).toBeGreaterThan(1);
      const afterMotion = dirty;
      image.classList.add("moved");
      await mutationTurn();
      expect(dirty).toBeGreaterThan(afterMotion);
      const video = document.createElement("video");
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: false,
      });
      Object.defineProperty(video, "ended", {
        configurable: true,
        value: false,
      });
      target.append(video);
      expect(provider!.needsContinuousFrames()).toBe(true);
      const beforePlay = dirty;
      video.dispatchEvent(new Event("play"));
      expect(dirty).toBeGreaterThan(beforePlay);
      video.remove();
      const authoredCanvas = document.createElement("canvas");
      target.append(authoredCanvas);
      expect(provider!.needsContinuousFrames()).toBe(true);
      authoredCanvas.dataset.anNativeCanvas = "owned";
      expect(provider!.needsContinuousFrames()).toBe(false);
      const beforeRuntimeStyle = dirty;
      authoredCanvas.style.width = "24px";
      await mutationTurn();
      expect(dirty).toBe(beforeRuntimeStyle);
      vi.spyOn(target, "getAnimations").mockReturnValue([
        { playState: "running" } as Animation,
      ]);
      expect(provider!.needsContinuousFrames()).toBe(true);
    } finally {
      provider!.dispose();
    }
  });
  it("wakes for relevant ancestor CSS motion without waking for unrelated or ancestor media events", () => {
    const ancestor = document.createElement("div");
    const target = document.createElement("div");
    const unrelated = document.createElement("div");
    ancestor.append(target);
    document.body.append(ancestor, unrelated);
    let wakes = 0;
    const provider = createNativeSceneProvider(target, "layer", () => {
      wakes += 1;
    });
    expect(provider).not.toBeNull();
    try {
      ancestor.dispatchEvent(new Event("animationstart", { bubbles: true }));
      ancestor.dispatchEvent(new Event("transitionrun", { bubbles: true }));
      expect(wakes).toBe(2);
      unrelated.dispatchEvent(new Event("animationstart", { bubbles: true }));
      ancestor.dispatchEvent(new Event("play", { bubbles: true }));
      expect(wakes).toBe(2);
      target.dispatchEvent(new Event("animationstart", { bubbles: true }));
      expect(wakes).toBe(3);
    } finally {
      provider!.dispose();
    }
    ancestor.dispatchEvent(new Event("animationstart", { bubbles: true }));
    expect(wakes).toBe(3);
  });
  it("ignores native canvas resizing and insertion during capture while rejecting authored edits", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const host = document.createElement("div");
    const authoredText = document.createTextNode("before");
    const nativeCanvas = document.createElement("canvas");
    nativeCanvas.setAttribute("data-an-native-canvas", "effect-1");
    host.append(authoredText, nativeCanvas);
    document.body.append(host);
    Object.defineProperties(host, {
      offsetWidth: { configurable: true, value: 8 },
      offsetHeight: { configurable: true, value: 8 },
    });

    let attempts = 0;
    let commits = 0;
    const started: Array<() => void> = [];
    const released: Array<() => void> = [];
    const gates = [2, 3].map(
      () =>
        new Promise<void>((resolve) => {
          released.push(resolve);
        }),
    );
    const entered = [2, 3].map(
      () =>
        new Promise<void>((resolve) => {
          started.push(resolve);
        }),
    );
    const leaf = new CachedLeaf(
      host,
      () => {
        commits += 1;
      },
      () => 1,
      async (_element, candidate) => {
        attempts += 1;
        if (attempts > 1) {
          started[attempts - 2]();
          await gates[attempts - 2];
        }
        candidate.width = 8;
        candidate.height = 8;
      },
    );
    try {
      await leaf.read();
      expect(commits).toBe(1);

      authoredText.textContent = "second";
      await mutationTurn();
      const second = leaf.read();
      await entered[0];
      nativeCanvas.width = 16;
      nativeCanvas.style.width = "16px";
      nativeCanvas.remove();
      await mutationTurn();
      released[0]();
      await expect(second).resolves.toMatchObject({ width: 8, height: 8 });
      expect(commits).toBe(2);

      leaf.invalidate();
      const third = leaf.read();
      const stale = expect(third).rejects.toMatchObject({
        code: "source-capture-stale",
      });
      await entered[1];
      authoredText.textContent = "changed during capture";
      await mutationTurn();
      released[1]();
      await stale;
      expect(commits).toBe(2);
      expect(attempts).toBe(3);
    } finally {
      released.forEach((release) => release());
      leaf.dispose();
    }
  });
});

describe("processed native layer source geometry", () => {
  it("composes a grid of bordered text cards with runtime native fills in CSS paint order", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const board = document.createElement("div");
    const grid = document.createElement("div");
    const card = document.createElement("div");
    card.setAttribute("data-an-native-fill-host", "");
    card.setAttribute("data-an-native-fill-positioned", "");
    card.setAttribute("data-an-native-fill-suppressed", "");
    const label = document.createElement("span");
    label.textContent = "Native fill";
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 60;
    canvas.setAttribute("data-an-native-canvas", "fill-1");
    canvas.style.cssText = "position:absolute;z-index:-1";
    const secondCard = document.createElement("div");
    secondCard.setAttribute("data-an-native-fill-host", "");
    secondCard.setAttribute("data-an-native-fill-positioned", "");
    secondCard.setAttribute("data-an-native-fill-suppressed", "");
    const secondLabel = document.createElement("span");
    secondLabel.textContent = "Second fill";
    const secondCanvas = document.createElement("canvas");
    secondCanvas.width = 100;
    secondCanvas.height = 60;
    secondCanvas.setAttribute("data-an-native-canvas", "fill-2");
    secondCanvas.style.cssText = "position:absolute;z-index:-1";
    card.append(canvas, label);
    secondCard.append(secondCanvas, secondLabel);
    grid.append(card, secondCard);
    board.append(grid);
    document.body.append(board);
    for (const [element, width, height, left, top, parent] of [
      [board, 300, 200, 0, 0, document.body],
      [grid, 300, 200, 0, 0, board],
      [card, 100, 60, 20, 20, grid],
      [canvas, 100, 60, 0, 0, card],
      [label, 100, 20, 0, 0, card],
      [secondCard, 100, 60, 130, 20, grid],
      [secondCanvas, 100, 60, 0, 0, secondCard],
      [secondLabel, 100, 20, 0, 0, secondCard],
    ] as const)
      Object.defineProperties(element, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
        offsetLeft: { value: left },
        offsetTop: { value: top },
        offsetParent: { value: parent },
      });
    const rects = new Map<Element, DOMRect>([
      [board, new DOMRect(0, 0, 300, 200)],
      [grid, new DOMRect(0, 0, 300, 200)],
      [card, new DOMRect(20, 20, 100, 60)],
      [canvas, new DOMRect(20, 20, 100, 60)],
      [label, new DOMRect(20, 20, 100, 20)],
      [secondCard, new DOMRect(130, 20, 100, 60)],
      [secondCanvas, new DOMRect(130, 20, 100, 60)],
      [secondLabel, new DOMRect(130, 20, 100, 20)],
    ]);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
      },
    );
    let secondLabelZIndex = "1";
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: element === grid ? "grid" : "block",
          visibility: "visible",
          opacity: element === card || element === secondCard ? "0.6" : "1",
          position:
            element === canvas || element === secondCanvas
              ? "absolute"
              : element === label || element === secondLabel
                ? "relative"
                : "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          scale: "none",
          isolation:
            element === card || element === secondCard ? "isolate" : "auto",
          zIndex:
            element === canvas || element === secondCanvas
              ? "-1"
              : element === label
                ? "1"
                : element === secondLabel
                  ? secondLabelZIndex
                  : "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage: "none",
          // guard:allow-raw-color — the fixture's authored grid paint must sit behind native cards.
          backgroundColor:
            element === board ? "rgb(23, 27, 38)" : "transparent",
          boxShadow: "none",
          outlineStyle: "none",
          clipPath: "none",
          maskImage: "none",
          overflowX:
            element === card || element === secondCard ? "hidden" : "visible",
          overflowY:
            element === card || element === secondCard ? "hidden" : "visible",
          borderTopWidth:
            element === card || element === secondCard ? "1px" : "0px",
          borderRightWidth:
            element === card || element === secondCard ? "1px" : "0px",
          borderBottomWidth:
            element === card || element === secondCard ? "1px" : "0px",
          borderLeftWidth:
            element === card || element === secondCard ? "1px" : "0px",
          borderTopLeftRadius:
            element === card || element === secondCard ? "8px" : "0px",
          borderTopRightRadius:
            element === card || element === secondCard ? "8px" : "0px",
          borderBottomRightRadius:
            element === card || element === secondCard ? "8px" : "0px",
          borderBottomLeftRadius:
            element === card || element === secondCard ? "8px" : "0px",
          paddingTop: "0px",
          paddingRight: "0px",
          paddingBottom: "0px",
          paddingLeft: "0px",
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(
      document.createElement("canvas"),
    );
    const provider = createNativeSceneProvider(board, "layer");
    try {
      const records = await provider!.readScene();
      expect(provider!.diagnosticSnapshot()).toMatchObject({
        readSceneCalls: 1,
        activeLeaves: 5,
        createdLeaves: 5,
        retiredLeaves: 0,
        omittedLeaves: 0,
        leaves: expect.arrayContaining([
          expect.objectContaining({ kind: "own-paint", captures: 0 }),
        ]),
      });
      expect(records.filter((record) => record.nativeInstanceId)).toEqual([
        expect.objectContaining({
          kind: "native",
          nativeInstanceId: "fill-1",
          node: canvas,
        }),
        expect.objectContaining({
          kind: "native",
          nativeInstanceId: "fill-2",
          node: secondCanvas,
        }),
      ]);
      expect(
        records
          .filter((record) =>
            [
              canvas,
              card,
              label,
              secondCanvas,
              secondCard,
              secondLabel,
            ].includes(record.node as HTMLElement),
          )
          .map((record) => record.node),
      ).toEqual([card, canvas, label, secondCard, secondCanvas, secondLabel]);
      const plan = planNativeSourceComposition(
        records.map((record) => ({
          id: `leaf:${record.key}`,
          box: record.rect,
          opacity: record.opacity,
          ownOpacityBaked: !!record.nativeInstanceId,
          isolationPath: record.isolationPath,
        })),
      );
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      const idOf = (node: Element) =>
        `leaf:${records.find((record) => record.node === node)!.key}`;
      expect(plan.root.children.slice(1)).toMatchObject([
        {
          kind: "group",
          isolationKind: "opacity",
          opacity: 0.6,
          children: [
            { kind: "leaf", id: idOf(card) },
            {
              kind: "group",
              isolationKind: "clip",
              children: [
                { kind: "leaf", id: idOf(canvas), ownOpacityBaked: true },
                { kind: "leaf", id: idOf(label) },
              ],
            },
          ],
        },
        {
          kind: "group",
          isolationKind: "opacity",
          opacity: 0.6,
          children: [
            { kind: "leaf", id: idOf(secondCard) },
            {
              kind: "group",
              isolationKind: "clip",
              children: [
                {
                  kind: "leaf",
                  id: idOf(secondCanvas),
                  ownOpacityBaked: true,
                },
                { kind: "leaf", id: idOf(secondLabel) },
              ],
            },
          ],
        },
      ]);
      secondLabelZIndex = "-2";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
    } finally {
      provider?.dispose();
    }
  });

  it("rejects transformed webfont Range capture before painting local text", async () => {
    const text = document.createElement("div");
    text.textContent = "Sample";
    text.style.scale = "2";
    document.body.append(text);
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      return element === text
        ? ({
            ...style,
            scale: "2",
            transformOrigin: "50% 50%",
          } as CSSStyleDeclaration)
        : style;
    });
    await expect(
      paintNativeTextFlow(text, document.createElement("canvas"), false),
    ).rejects.toMatchObject({ code: "source-webfont-transform-unsupported" });
  });
  it("records a rotated descendant and its rounded ancestor clip in local coordinates", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    const group = document.createElement("div");
    const child = document.createElement("canvas");
    child.width = 20;
    child.height = 10;
    group.append(child);
    target.append(group);
    document.body.append(target);
    Object.defineProperties(target, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
    });
    Object.defineProperties(group, {
      offsetWidth: { value: 40 },
      offsetHeight: { value: 30 },
      offsetLeft: { value: 10 },
      offsetTop: { value: 10 },
      offsetParent: { value: target },
    });
    Object.defineProperties(child, {
      offsetWidth: { value: 20 },
      offsetHeight: { value: 10 },
      offsetLeft: { value: 4 },
      offsetTop: { value: 5 },
      offsetParent: { value: group },
    });
    const sibling = document.createElement("canvas");
    sibling.width = 20;
    sibling.height = 10;
    Object.defineProperties(sibling, {
      offsetWidth: { value: 20 },
      offsetHeight: { value: 10 },
      offsetLeft: { value: 0 },
      offsetTop: { value: 20 },
      offsetParent: { value: target },
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          visibility: "visible",
          opacity: "1",
          position: "absolute",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: element === group ? "90deg" : "none",
          scale: "none",
          isolation: "auto",
          zIndex: element === sibling ? sibling.style.zIndex || "auto" : "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage: "none",
          backgroundColor: "rgba(0, 0, 0, 0)",
          objectFit: "fill",
          objectPosition: "50% 50%",
          boxShadow: "none",
          outlineStyle: "none",
          clipPath: "none",
          maskImage: "none",
          overflowX: element === group ? "hidden" : "visible",
          overflowY: element === group ? "hidden" : "visible",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          borderBottomWidth: "0px",
          borderLeftWidth: "0px",
          borderTopLeftRadius: element === group ? "6px" : "0px",
          borderTopRightRadius: "0px",
          borderBottomRightRadius: "0px",
          borderBottomLeftRadius: "0px",
          paddingTop: "0px",
          paddingRight: "0px",
          paddingBottom: "0px",
          paddingLeft: "0px",
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(target, "layer");
    try {
      const record = (await provider!.readScene()).find(
        (item) => item.node === child,
      );
      expect(record).toMatchObject({
        kind: "canvas",
        localBox: { x: 0, y: 0, width: 20, height: 10 },
        rect: { x: -5, y: 14, width: 10, height: 20 },
        isolationPath: [{ kind: "clip" }],
      });
      expect(record!.localToTarget.a).toBeCloseTo(0);
      expect(record!.localToTarget.b).toBeCloseTo(1);
      expect(record!.localToTarget.c).toBeCloseTo(-1);
      expect(record!.groupClips[0]?.clip).toMatchObject({
        localBox: { x: 0, y: 0, width: 40, height: 30 },
        radii: { topLeft: { x: 6, y: 6 } },
      });
      target.append(sibling);
      await expect(provider!.readScene()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ node: child, kind: "canvas" }),
          expect.objectContaining({ node: sibling, kind: "canvas" }),
        ]),
      );
      sibling.style.zIndex = "-1";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
    } finally {
      provider?.dispose();
    }
  });
  it("composes a transformed source image before its overlapping badge", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    const image = document.createElement("img");
    const badge = document.createElement("span");
    image.src = "data:image/png;base64,iVBORw0KGgo=";
    badge.textContent = "FRAME / 03";
    target.append(image, badge);
    document.body.append(target);
    Object.defineProperties(target, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 80 },
    });
    Object.defineProperties(image, {
      offsetWidth: { value: 80 },
      offsetHeight: { value: 60 },
      offsetLeft: { value: 0 },
      offsetTop: { value: 0 },
      offsetParent: { value: target },
      complete: { value: true },
      naturalWidth: { value: 80 },
      naturalHeight: { value: 60 },
    });
    Object.defineProperties(badge, {
      offsetWidth: { value: 50 },
      offsetHeight: { value: 22 },
      offsetLeft: { value: 20 },
      offsetTop: { value: 30 },
      offsetParent: { value: target },
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          visibility: "visible",
          opacity: "1",
          position:
            element === target
              ? "relative"
              : element === badge
                ? "absolute"
                : "static",
          transform: element === image ? "matrix(1, 0, 0, 1, 14, 0)" : "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          zIndex: element === badge ? badge.style.zIndex || "auto" : "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage: "none",
          backgroundColor: "transparent",
          objectFit: "fill",
          objectPosition: "50% 50%",
          boxShadow: "none",
          outlineStyle: "none",
          clipPath: "none",
          maskImage: "none",
          overflowX: element === target ? "hidden" : "visible",
          overflowY: element === target ? "hidden" : "visible",
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
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const capture = document.createElement("canvas");
    capture.width = 50;
    capture.height = 22;
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(capture);
    const provider = createNativeSceneProvider(target, "layer");
    try {
      const records = await provider!.readScene();
      expect(records.map((record) => record.node)).toEqual([image, badge]);
      badge.style.zIndex = "-1";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
    } finally {
      provider?.dispose();
    }
  });

  it("rejects interleaved records from an atomic transformed source context", () => {
    const context = document.createElement("div");
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    const badge = document.createElement("span");
    context.append(first, second);
    expect(
      transformedSourcePaintIsContiguous(
        [first, second, badge],
        [context, context, null],
      ),
    ).toBe(true);
    expect(
      transformedSourcePaintIsContiguous(
        [first, badge, second],
        [context, null, context],
      ),
    ).toBe(false);
  });

  it("stops target-local source clipping at the selected board frame, including its own paint", () => {
    const target = document.createElement("div");
    target.style.translate = "4096px 4096px";
    target.style.overflow = "hidden";
    document.documentElement.style.overflow = "clip";
    document.body.append(target);

    Object.defineProperties(target, {
      offsetWidth: { configurable: true, value: 100 },
      offsetHeight: { configurable: true, value: 80 },
    });
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const overrides = {
        overflowX: element === target ? "hidden" : "clip",
        overflowY: element === target ? "hidden" : "clip",
        display: "block",
        visibility: "visible",
        opacity: "1",
        mixBlendMode: "normal",
        filter: "none",
        backdropFilter: "none",
        backgroundImage: "none",
        maskImage: "none",
        perspective: "none",
        transformStyle: "flat",
        transform: "none",
        translate: "none",
        rotate: "none",
        scale: "none",
        content: "none",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        borderLeftWidth: "0px",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        paddingLeft: "0px",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
      };
      return new Proxy(computedStyle(element), {
        get(style, property) {
          if (property === "getPropertyValue") return () => "0px";
          if (typeof property === "string" && property in overrides)
            return overrides[property as keyof typeof overrides];
          const value = Reflect.get(style, property, style);
          return typeof value === "function" ? value.bind(style) : value;
        },
      });
    });
    expect(sourceClipPlan(target, target, "target-local", false)).toMatchObject(
      {
        clip: { x: 0, y: 0, width: 100, height: 80 },
        groupClips: [],
      },
    );
  });

  it("removes all target affine channels from an own-paint capture clone", () => {
    const target = document.createElement("div");
    target.textContent = "Editable text";
    target.style.transform = "matrix(0, 1, -1, 0, 0, 0)";
    target.style.translate = "4096px 4096px";
    target.style.rotate = "20deg";
    target.style.scale = "1.5 0.75";
    document.body.append(target);
    const clone = cloneNativeTextFlow(target);
    expect(clone.style.transform).toBe("none");
    expect(clone.style.translate).toBe("none");
    expect(clone.style.rotate).toBe("none");
    expect(clone.style.scale).toBe("none");
  });

  it("composes an expanded native layer after an overlapping normal-flow caption", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const section = document.createElement("section");
    const target = document.createElement("div");
    target.setAttribute("data-an-native-layer-instance", "blur-effect");
    const image = document.createElement("img");
    const overlaidText = document.createElement("span");
    overlaidText.textContent = "Design";
    target.append(image, overlaidText);
    const presentation = document.createElement("canvas");
    presentation.dataset.anNativeCanvas = "blur-effect";
    presentation.setAttribute("data-an-native-presentation", "");
    const caption = document.createElement("h2");
    caption.textContent = "Gaussian Blur";
    section.append(target, presentation, caption);
    document.body.append(section);
    const bounds = new Map<Element, DOMRect>([
      [document.body, new DOMRect(0, 0, 1080, 650)],
      [section, new DOMRect(0, 0, 250, 193)],
      [target, new DOMRect(0, 0, 250, 150)],
      [presentation, new DOMRect(-24, -24, 298, 198)],
      [caption, new DOMRect(0, 160, 250, 20)],
    ]);
    for (const [element, rect] of bounds) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: rect.width },
        offsetHeight: { configurable: true, value: rect.height },
        offsetLeft: { configurable: true, value: rect.x },
        offsetTop: { configurable: true, value: rect.y },
      });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return bounds.get(this) ?? new DOMRect(0, 0, 0, 0);
      },
    );
    const source = document.createElement("canvas");
    source.width = 250;
    source.height = 20;
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(source);
    let captionZIndex = "auto";
    let targetZIndex = "auto";
    let targetPosition = "relative";
    let captionOrder = "0";
    let sectionDisplay = "block";
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display:
            element === document.head
              ? "none"
              : element === section
                ? sectionDisplay
                : "block",
          visibility: "visible",
          opacity: "1",
          position:
            element === section
              ? "absolute"
              : element === target
                ? targetPosition
                : element === presentation ||
                    (captionZIndex !== "auto" && element === caption)
                  ? "absolute"
                  : "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          rotate: "none",
          scale: "none",
          perspective: "none",
          transformStyle: "flat",
          isolation: "auto",
          zIndex:
            element === caption
              ? captionZIndex
              : element === target
                ? targetZIndex
                : "auto",
          order: element === caption ? captionOrder : "0",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage: "none",
          backgroundColor: "rgba(0, 0, 0, 0)",
          boxShadow: "none",
          outlineStyle: "none",
          clipPath: "none",
          maskImage: "none",
          overflowX: element === target ? "hidden" : "visible",
          overflowY: element === target ? "hidden" : "visible",
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
          getPropertyValue: () => "0px",
          content: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(document.body, "layer");
    try {
      const records = await provider!.readScene();
      expect(records.map((record) => record.node)).toEqual([caption, target]);
      expect(records.map((record) => record.kind)).toEqual(["dom", "native"]);
      expect(
        planNativeSourceComposition(
          records.map((record) => ({
            id: `leaf:${record.key}`,
            box: record.rect,
            opacity: record.opacity,
            ownOpacityBaked: !!record.nativeInstanceId,
            isolationPath: record.isolationPath,
          })),
        ).ok,
      ).toBe(true);
      captionZIndex = "-1";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
      captionZIndex = "auto";
      sectionDisplay = "flex";
      targetPosition = "static";
      targetZIndex = "0";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
      targetZIndex = "auto";
      sectionDisplay = "grid";
      captionOrder = "1";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
    } finally {
      provider?.dispose();
    }
  });

  it("uses target-local presentation bounds when the selected target has its own affine transform", async () => {
    const group = document.createElement("div");
    const child = document.createElement("div");
    child.setAttribute("data-an-native-layer-instance", "halo-effect");
    const presentation = document.createElement("canvas");
    presentation.dataset.anNativeCanvas = "halo-effect";
    presentation.setAttribute("data-an-native-presentation", "");
    group.append(child, presentation);
    document.body.append(group);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === group) return new DOMRect(4096, 4096, 100, 100);
        if (this === child) return new DOMRect(4000, 4100, 40, 40);
        if (this === presentation) return new DOMRect(4080, 4080, 40, 40);
        return new DOMRect(0, 0, 0, 0);
      },
    );
    Object.defineProperties(child, {
      offsetWidth: { value: 20 },
      offsetHeight: { value: 20 },
      offsetLeft: { value: 10 },
      offsetTop: { value: 10 },
    });
    Object.defineProperties(group, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
    });
    Object.defineProperties(presentation, {
      offsetWidth: { value: 28 },
      offsetHeight: { value: 28 },
      offsetLeft: { value: 6 },
      offsetTop: { value: 6 },
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: "block",
          visibility: "visible",
          opacity: "1",
          position: "static",
          transform: element === group ? "matrix(0, 1, -1, 0, 0, 0)" : "none",
          transformOrigin: "0px 0px",
          translate: element === group ? "4096px 4096px" : "none",
          scale: element === group ? "1.5 0.75" : "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          isolation: "auto",
          zIndex: "auto",
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
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(group, "layer");
    try {
      const records = await provider!.readScene();
      expect(records).toEqual([
        expect.objectContaining({
          kind: "native",
          nativeInstanceId: "halo-effect",
          coordinateSpace: "target-local",
          rect: { x: 6, y: 6, width: 28, height: 28 },
        }),
      ]);
    } finally {
      provider?.dispose();
    }
  });
});

describe("legacy shader source boundary", () => {
  it("rejects a visible legacy canvas in layer and backdrop source while ignoring a hidden or disjoint canvas", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const group = document.createElement("div");
    const legacy = document.createElement("canvas");
    legacy.setAttribute("data-an-shader-canvas", "legacy-fill");
    const receiver = document.createElement("div");
    group.append(legacy);
    document.body.append(group, receiver);
    for (const element of [document.documentElement, document.body]) {
      Object.defineProperties(element, {
        offsetWidth: { value: 100, configurable: true },
        offsetHeight: { value: 100, configurable: true },
      });
    }
    Object.defineProperties(receiver, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
    });
    Object.defineProperties(group, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
    });
    Object.defineProperties(legacy, {
      offsetWidth: { value: 60 },
      offsetHeight: { value: 60 },
      offsetLeft: { get: () => legacyLeft },
      offsetTop: { value: 10 },
    });
    let legacyLeft = 20;
    let legacyDisplay = "block";
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === legacy) return new DOMRect(legacyLeft, 10, 60, 60);
        if (this === receiver) return new DOMRect(10, 0, 100, 100);
        return new DOMRect(0, 0, 100, 100);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display:
            element === document.head
              ? "none"
              : element === legacy
                ? legacyDisplay
                : "block",
          visibility: "visible",
          opacity: "1",
          position: "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          zIndex: "auto",
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
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const layer = createNativeSceneProvider(group, "layer");
    const backdrop = createNativeSceneProvider(receiver, "backdrop");
    try {
      await expect(layer!.readScene()).rejects.toMatchObject({
        code: "source-legacy-shader-unsupported",
      });
      await expect(backdrop!.readScene()).rejects.toMatchObject({
        code: "source-legacy-shader-unsupported",
      });
      legacyDisplay = "none";
      await expect(layer!.readScene()).resolves.toEqual([]);
      legacyDisplay = "block";
      legacyLeft = 150;
      await expect(layer!.readScene()).resolves.toEqual([]);
    } finally {
      layer?.dispose();
      backdrop?.dispose();
    }
  });
});

describe("CSS canvas background source", () => {
  it("paints an opaque root or propagated body color across a taller export viewport only", async () => {
    const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1024,
    });
    let rootColor = "rgb(246, 240, 231)";
    let bodyColor = "rgba(0, 0, 0, 0)";
    let rootImage = "none";
    let rootHeight = 934.5;
    Object.defineProperties(document.documentElement, {
      offsetWidth: { configurable: true, value: 1440 },
      offsetHeight: { configurable: true, get: () => rootHeight },
    });
    Object.defineProperties(document.body, {
      offsetWidth: { configurable: true, value: 1440 },
      offsetHeight: { configurable: true, value: 934.5 },
    });
    const cached = document.createElement("canvas");
    cached.width = 1440;
    cached.height = 935;
    let receiver: HTMLDivElement | null = null;
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(cached);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (kind: string) {
        return kind === "2d"
          ? ({
              fillStyle: "",
              fillRect() {},
            } as unknown as CanvasRenderingContext2D)
          : null;
      } as typeof HTMLCanvasElement.prototype.getContext,
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === receiver) return new DOMRect(0, 960, 100, 100);
        return this === document.documentElement || this === document.body
          ? new DOMRect(
              0,
              0,
              1440,
              this === document.documentElement ? rootHeight : 934.5,
            )
          : new DOMRect(0, 0, 0, 0);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: element === document.head ? "none" : "block",
          visibility: "visible",
          opacity: "1",
          position: "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          zIndex: "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundImage:
            element === document.documentElement ? rootImage : "none",
          backgroundColor:
            element === document.documentElement ? rootColor : bodyColor,
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
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const rootProvider = createNativeSceneProvider(
      document.documentElement,
      "layer",
    );
    try {
      const records = await rootProvider!.readScene();
      expect(records[0]).toMatchObject({
        sourceRole: "viewport-background",
        node: document.documentElement,
        width: 1,
        height: 1,
        rect: { x: 0, y: 0, width: 1440, height: 1024 },
        clip: { x: 0, y: 0, width: 1440, height: 1024 },
      });
      expect(records[1]).toMatchObject({
        node: document.documentElement,
        rect: { x: 0, y: 0, width: 1440, height: 934.5 },
      });
      rootColor = "rgba(0, 0, 0, 0)";
      bodyColor = "rgb(246, 240, 231)";
      rootHeight = 1024;
      const propagated = await rootProvider!.readScene();
      expect(propagated[0]).toMatchObject({
        sourceRole: "viewport-background",
        node: document.body,
        rect: { x: 0, y: 0, width: 1440, height: 1024 },
        clip: { x: 0, y: 0, width: 1440, height: 1024 },
      });
      rootImage = "linear-gradient(red, blue)";
      await expect(rootProvider!.readScene()).rejects.toMatchObject({
        code: "source-viewport-background-unsupported",
      });
      rootImage = "none";
      const selected = createNativeSceneProvider(document.body, "layer");
      try {
        const selectedRecords = await selected!.readScene();
        expect(selectedRecords.some((record) => record.sourceRole)).toBe(false);
      } finally {
        selected?.dispose();
      }
      receiver = document.createElement("div");
      Object.defineProperties(receiver, {
        offsetWidth: { configurable: true, value: 100 },
        offsetHeight: { configurable: true, value: 100 },
        offsetLeft: { configurable: true, value: 0 },
        offsetTop: { configurable: true, value: 960 },
      });
      document.body.append(receiver);
      const backdrop = createNativeSceneProvider(receiver, "backdrop");
      try {
        const backdropRecords = await backdrop!.readScene();
        expect(backdropRecords[0]).toMatchObject({
          sourceRole: "viewport-background",
          node: document.body,
          rect: { x: expect.any(Number), y: -960, width: 1440, height: 1024 },
          clip: { x: 0, y: 0, width: 100, height: 64 },
        });
      } finally {
        backdrop?.dispose();
      }
    } finally {
      rootProvider?.dispose();
      if (innerWidth) Object.defineProperty(window, "innerWidth", innerWidth);
      else Reflect.deleteProperty(window, "innerWidth");
      if (innerHeight)
        Object.defineProperty(window, "innerHeight", innerHeight);
      else Reflect.deleteProperty(window, "innerHeight");
    }
  });
  it("uses the viewport when absolute artwork leaves html and body with zero layout height", async () => {
    const priorWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const priorHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1162,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 887,
    });
    const root = document.documentElement;
    const body = document.body;
    Object.defineProperties(root, {
      offsetWidth: { configurable: true, value: 8192 },
      offsetHeight: { configurable: true, value: 0 },
    });
    Object.defineProperties(body, {
      offsetWidth: { configurable: true, value: 8192 },
      offsetHeight: { configurable: true, value: 0 },
    });
    const artwork = document.createElement("canvas");
    artwork.dataset.anNativeCanvas = "selected-fill";
    Object.defineProperties(artwork, {
      offsetWidth: { value: 1162 },
      offsetHeight: { value: 887 },
      offsetLeft: { value: 218 },
      offsetTop: { value: 2069 },
      offsetParent: { value: body },
    });
    const empty = document.createElement("div");
    Object.defineProperties(empty, {
      offsetWidth: { configurable: true, value: 0 },
      offsetHeight: { configurable: true, value: 0 },
    });
    empty.append(artwork);
    body.append(empty);
    let wrapperOverflow = "visible";
    let rootColor = "rgba(0, 0, 0, 0)";
    let bodyColor = "rgba(0, 0, 0, 0)";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (kind: string) {
        return kind === "2d"
          ? ({
              fillStyle: "",
              fillRect() {},
            } as unknown as CanvasRenderingContext2D)
          : null;
      } as typeof HTMLCanvasElement.prototype.getContext,
    );
    const styleFor = (element: Element) =>
      ({
        imageRendering: "auto",
        display: element === document.head ? "none" : "block",
        visibility: "visible",
        opacity: "1",
        position: element === artwork ? "absolute" : "static",
        transform: "none",
        transformOrigin: "0px 0px",
        translate: element === body ? "-218px -2069px" : "none",
        perspective: "none",
        transformStyle: "flat",
        rotate: "none",
        scale: "none",
        isolation: "auto",
        zIndex: "auto",
        mixBlendMode: "normal",
        filter: "none",
        backdropFilter: "none",
        backgroundImage: "none",
        backgroundColor:
          element === root
            ? rootColor
            : element === body
              ? bodyColor
              : "rgba(0, 0, 0, 0)",
        boxShadow: "none",
        outlineStyle: "none",
        clipPath: "none",
        maskImage: "none",
        overflowX:
          element === root
            ? "clip"
            : element === empty
              ? wrapperOverflow
              : "visible",
        overflowY:
          element === root
            ? "clip"
            : element === empty
              ? wrapperOverflow
              : "visible",
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
        getPropertyValue: () => "0px",
        content: "none",
      }) as unknown as CSSStyleDeclaration;
    vi.spyOn(window, "getComputedStyle").mockImplementation(styleFor);
    const provider = createNativeSceneProvider(root, "layer");
    try {
      const records = await provider!.readScene();
      expect(records).toEqual([
        expect.objectContaining({
          nativeInstanceId: "selected-fill",
          rect: { x: 0, y: 0, width: 1162, height: 887 },
          clip: { x: 0, y: 0, width: 1162, height: 887 },
        }),
      ]);
      expect(
        planNativeSourceComposition(
          records.map((record) => ({
            id: `leaf:${record.key}`,
            box: record.rect,
            opacity: record.opacity,
            ownOpacityBaked: !!record.nativeInstanceId,
            isolationPath: record.isolationPath,
          })),
        ).ok,
      ).toBe(true);
      rootColor = "rgb(246, 240, 231)";
      expect((await provider!.readScene())[0]).toMatchObject({
        sourceRole: "viewport-background",
        node: root,
        rect: { x: 0, y: 0, width: 1162, height: 887 },
      });
      rootColor = "rgba(0, 0, 0, 0)";
      bodyColor = "rgb(246, 240, 231)";
      expect((await provider!.readScene())[0]).toMatchObject({
        sourceRole: "viewport-background",
        node: body,
        rect: { x: 0, y: 0, width: 1162, height: 887 },
      });
      bodyColor = "rgba(0, 0, 0, 0)";
      wrapperOverflow = "hidden";
      await expect(provider!.readScene()).resolves.toEqual([]);
      wrapperOverflow = "visible";
      Object.defineProperty(empty, "offsetWidth", {
        configurable: true,
        value: Number.NaN,
      });
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-transform",
      });
    } finally {
      provider?.dispose();
      if (priorWidth) Object.defineProperty(window, "innerWidth", priorWidth);
      else Reflect.deleteProperty(window, "innerWidth");
      if (priorHeight)
        Object.defineProperty(window, "innerHeight", priorHeight);
      else Reflect.deleteProperty(window, "innerHeight");
    }
  });
});

describe("backdrop sibling paint order", () => {
  it("exposes a descendant Backdrop as an ordered native dependency without baking the parent opacity", async () => {
    const group = document.createElement("div");
    const canvas = document.createElement("canvas");
    const receiver = document.createElement("div");
    group.style.opacity = "0.5";
    receiver.style.opacity = "0.25";
    canvas.width = 100;
    canvas.height = 80;
    canvas.dataset.anNativeCanvas = "child-backdrop";
    canvas.setAttribute("data-an-native-backdrop-presentation", "");
    canvas.setAttribute("data-an-native-backdrop-receiver-node-id", "child");
    receiver.setAttribute("data-agent-native-node-id", "child");
    group.append(canvas, receiver);
    document.body.append(group);
    for (const element of [group, canvas, receiver]) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: 100 },
        offsetHeight: { configurable: true, value: 80 },
      });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 80),
    );
    const originalStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...originalStyle(element, pseudo),
          display: "block",
          visibility: "visible",
          opacity:
            element === group ? "0.5" : element === receiver ? "0.25" : "1",
          position: "static",
          transform: "none",
          transformOrigin: "0px 0px",
          translate: "none",
          perspective: "none",
          transformStyle: "flat",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          zIndex: "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundImage: "none",
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
          getPropertyValue: () => "0px",
        }) as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(group, "layer");
    try {
      provider!.setGroupLocalBackdropSource(true);
      const records = await provider!.readScene();
      const child = records.find(
        (record) => record.nativeInstanceId === "child-backdrop",
      );
      expect(child).toMatchObject({ kind: "native", node: canvas });
      expect(
        child?.isolationPath?.some(
          (entry) => entry.kind === "opacity" && entry.opacity === 0.5,
        ),
      ).toBe(false);
      expect(
        child?.isolationPath?.filter(
          (entry) => entry.kind === "opacity" && entry.opacity === 0.25,
        ),
      ).toHaveLength(1);
    } finally {
      provider?.dispose();
      group.remove();
    }
  });

  it("gives a backdrop canvas and its receiver foreground one opacity group", () => {
    const canvas = document.createElement("canvas");
    canvas.dataset.anNativeCanvas = "paired-backdrop";
    canvas.setAttribute("data-an-native-backdrop-presentation", "");
    canvas.setAttribute("data-an-native-backdrop-receiver-node-id", "receiver");
    const receiver = document.createElement("div");
    receiver.setAttribute("data-agent-native-node-id", "receiver");
    receiver.style.opacity = "0.5";
    const child = document.createElement("span");
    child.style.opacity = "0.25";
    receiver.append(child);
    document.body.append(canvas, receiver);
    const second = document.createElement("canvas");
    second.dataset.anNativeCanvas = "second-backdrop";
    second.setAttribute("data-an-native-backdrop-presentation", "");
    second.setAttribute("data-an-native-backdrop-receiver-node-id", "receiver");
    receiver.before(second);
    const originalStyle = window.getComputedStyle;
    let receiverOpacity = "0.5";
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...originalStyle(element, pseudo),
          opacity:
            element === receiver
              ? receiverOpacity
              : element === child
                ? "0.25"
                : "1",
        }) as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(
      document.documentElement,
      "layer",
    );
    const fillProvider = createNativeSceneProvider(receiver, "fill");
    if (!provider || !fillProvider)
      throw new Error("Scene provider unavailable.");
    const isolationPath = (
      provider as unknown as {
        isolationPath(
          element: Element,
          clips: [],
          baked: boolean,
          layerOutputOpacityDeferred?: boolean,
        ): Array<{ id: string; kind: string; opacity?: number }> | null;
      }
    ).isolationPath.bind(provider);
    const fillIsolationPath = (
      fillProvider as unknown as {
        isolationPath(
          element: Element,
          clips: [],
          baked: boolean,
        ): Array<{ id: string; kind: string; opacity?: number }> | null;
      }
    ).isolationPath.bind(fillProvider);
    try {
      const canvasPath = isolationPath(canvas, [], true);
      const secondPath = isolationPath(second, [], true);
      const foregroundPath = isolationPath(receiver, [], false);
      const receiverGroup = canvasPath?.find((entry) =>
        entry.id.startsWith("receiver:"),
      );
      expect(receiverGroup).toMatchObject({ kind: "opacity", opacity: 0.5 });
      expect(secondPath).toContainEqual(receiverGroup);
      expect(foregroundPath).toContainEqual(receiverGroup);
      expect(
        foregroundPath?.filter((entry) => entry.kind === "opacity"),
      ).toEqual([receiverGroup]);
      expect(fillIsolationPath(receiver, [], false)).toEqual([]);
      expect(fillIsolationPath(child, [], false)).toEqual([
        expect.objectContaining({ kind: "opacity", opacity: 0.25 }),
      ]);
      receiver.setAttribute("data-an-native-layer-instance", "baked-layer");
      expect(() => isolationPath(receiver, [], true)).toThrowError(
        "source-composition-unsupported",
      );
      const layerProvider = createNativeSceneProvider(receiver, "layer");
      if (!layerProvider) throw new Error("Layer provider unavailable.");
      const layerIsolationPath = (
        layerProvider as unknown as {
          isolationPath(
            element: Element,
            clips: [],
            baked: boolean,
          ): Array<{ kind: string; opacity?: number }> | null;
        }
      ).isolationPath.bind(layerProvider);
      try {
        expect(layerIsolationPath(receiver, [], false)).toContainEqual(
          expect.objectContaining({ kind: "opacity", opacity: 0.5 }),
        );
        const initialEpoch = layerProvider.sourceEpoch?.();
        layerProvider.setLayerTargetOpacityDeferred(true);
        expect(layerProvider.sourceEpoch?.()).toBeGreaterThan(initialEpoch!);
        expect(layerIsolationPath(receiver, [], false)).toEqual([]);
        receiverOpacity = "0";
        expect(layerIsolationPath(receiver, [], false)).toEqual([]);
        receiverOpacity = "0.5";
        expect(layerIsolationPath(child, [], false)).toContainEqual(
          expect.objectContaining({ kind: "opacity", opacity: 0.25 }),
        );
        expect(isolationPath(receiver, [], true, true)).toContainEqual(
          receiverGroup,
        );
        layerProvider.setLayerTargetOpacityDeferred(false);
        expect(layerIsolationPath(receiver, [], false)).toContainEqual(
          expect.objectContaining({ kind: "opacity", opacity: 0.5 }),
        );
      } finally {
        layerProvider.dispose();
      }
      receiver.removeAttribute("data-an-native-layer-instance");
      receiver.setAttribute("data-an-native-fill-instance", "shared-fill");
      expect(isolationPath(receiver, [], false)).toContainEqual(receiverGroup);
      receiver.setAttribute("data-agent-native-node-id", "other-receiver");
      expect(() => isolationPath(canvas, [], true)).toThrowError(
        "source-composition-unsupported",
      );
    } finally {
      provider.dispose();
      fillProvider?.dispose();
      canvas.remove();
      second.remove();
      receiver.remove();
    }
  });

  it("ignores later editor overlays and empty preceding boxes, but rejects painted z-order conflicts", () => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    document.documentElement.append(overlay);
    let painted = false;
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display: element === document.head ? "none" : "block",
          visibility: "visible",
          opacity: "1",
          position: element === overlay ? "fixed" : "static",
          transform: "none",
          isolation: "auto",
          zIndex: element === overlay ? overlay.style.zIndex : "auto",
          backgroundImage: "none",
          backgroundColor:
            element === overlay && painted
              ? "rgb(255, 0, 0)"
              : "rgba(0, 0, 0, 0)",
          boxShadow: "none",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          borderBottomWidth: "0px",
          borderLeftWidth: "0px",
        }) as CSSStyleDeclaration,
    );
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const bodyPaint = { node: document.body, rect: box, clip: box };
    try {
      expect(() =>
        assertDomSiblingOrder(
          document.documentElement,
          document.body,
          document.body,
          [bodyPaint],
        ),
      ).not.toThrow();

      document.documentElement.insertBefore(overlay, document.body);
      expect(() =>
        assertDomSiblingOrder(
          document.documentElement,
          document.body,
          document.body,
          [bodyPaint],
        ),
      ).not.toThrow();

      expect(() =>
        assertDomSiblingOrder(
          document.documentElement,
          document.body,
          document.body,
          [{ node: overlay, rect: box, clip: box }, bodyPaint],
        ),
      ).toThrowError(
        "Overlapping CSS stacking order differs from this source compositor's DOM order.",
      );

      document.documentElement.append(overlay);
      overlay.style.zIndex = "-1";
      expect(() =>
        assertDomSiblingOrder(
          document.documentElement,
          document.body,
          document.body,
          [bodyPaint],
        ),
      ).not.toThrow();
      painted = true;
      expect(() =>
        assertDomSiblingOrder(
          document.documentElement,
          document.body,
          document.body,
          [bodyPaint],
        ),
      ).toThrowError("A later source may paint behind the backdrop receiver.");
    } finally {
      overlay.remove();
    }
  });

  it("reads past a later empty overlay but rejects later painted negative-z artwork", async () => {
    const artwork = document.createElement("div");
    const receiver = document.createElement("div");
    const later = document.createElement("div");
    later.style.cssText = "position:fixed;z-index:2147483647";
    let bodyDisplay = "block";
    let laterPosition = "fixed";
    let laterOrder = "0";
    document.body.append(artwork, receiver, later);
    for (const element of [document.documentElement, document.body]) {
      Object.defineProperties(element, {
        offsetWidth: { value: 100, configurable: true },
        offsetHeight: { value: 100, configurable: true },
      });
    }
    for (const element of [artwork, receiver, later]) {
      Object.defineProperties(element, {
        offsetWidth: { value: 100 },
        offsetHeight: { value: 100 },
      });
    }
    const source = document.createElement("canvas");
    source.width = 100;
    source.height = 100;
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(source);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this === document.head
          ? new DOMRect(0, 0, 0, 0)
          : new DOMRect(0, 0, 100, 100);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering: "auto",
          display:
            element === document.head
              ? "none"
              : element === document.body
                ? bodyDisplay
                : "block",
          visibility: "visible",
          opacity: "1",
          position:
            element === later
              ? laterPosition
              : element === receiver && receiver.style.position
                ? receiver.style.position
                : "static",
          transform: "none",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          order: element === later ? laterOrder : "0",
          zIndex:
            element === later
              ? later.style.zIndex
              : element === receiver
                ? receiver.style.zIndex || "auto"
                : "auto",
          backgroundImage: "none",
          backgroundColor:
            element === artwork || (element === later && later.dataset.painted)
              ? "rgb(255, 0, 0)"
              : "rgba(0, 0, 0, 0)",
          boxShadow: "none",
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
          getPropertyValue: () => "0px",
          content: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(receiver, "backdrop");
    expect(provider).not.toBeNull();
    try {
      await expect(provider!.readScene()).resolves.toEqual([
        expect.objectContaining({ node: artwork, kind: "dom" }),
      ]);
      later.style.zIndex = "-1";
      later.dataset.painted = "true";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
      later.style.zIndex = "2147483647";
      await expect(provider!.readScene()).resolves.toEqual([
        expect.objectContaining({ node: artwork, kind: "dom" }),
      ]);
      receiver.style.cssText = "position:absolute;z-index:2";
      later.style.zIndex = "auto";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
      receiver.style.cssText = "";
      laterPosition = "static";
      bodyDisplay = "flex";
      laterOrder = "1";
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-stacking-order",
      });
    } finally {
      provider?.dispose();
    }
  });
});

describe("clipped own DOM paint", () => {
  it.each([
    {
      overflowMode: "hidden",
      margin: "0px",
      edge: "padding",
      outset: 0,
      x: 3,
      width: 114,
    },
    {
      overflowMode: "clip",
      margin: "content-box",
      edge: "content",
      outset: 0,
      x: 10,
      width: 100,
    },
    {
      overflowMode: "clip",
      margin: "content-box 4px",
      edge: "content",
      outset: 4,
      x: 6,
      width: 108,
    },
    {
      overflowMode: "clip",
      margin: "2px border-box",
      edge: "border",
      outset: 2,
      x: -2,
      width: 124,
    },
  ] as const)(
    "keeps the painted border box while $overflowMode/$margin clips direct text at its own edge",
    async ({ overflowMode, margin, edge, outset, x, width }) => {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as typeof ResizeObserver;
      const target = document.createElement("div");
      target.textContent = "Editable label";
      document.body.append(target);
      Object.defineProperties(target, {
        offsetWidth: { configurable: true, value: 120 },
        offsetHeight: { configurable: true, value: 60 },
        offsetLeft: { configurable: true, value: 0 },
        offsetTop: { configurable: true, value: 0 },
      });
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 120, 60),
      );
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        () =>
          ({
            imageRendering: "auto",
            display: "block",
            visibility: "visible",
            opacity: "1",
            position: "static",
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
            // guard:allow-raw-color — authored paint is intentionally distinct from transparent source.
            backgroundColor: "rgb(58, 104, 128)",
            boxShadow: "none",
            outlineStyle: "none",
            clipPath: "none",
            maskImage: "none",
            overflowX: overflowMode,
            overflowY: overflowMode,
            borderTopWidth: "3px",
            borderRightWidth: "3px",
            borderBottomWidth: "3px",
            borderLeftWidth: "3px",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            borderBottomRightRadius: "8px",
            borderBottomLeftRadius: "8px",
            paddingTop: "7px",
            paddingRight: "7px",
            paddingBottom: "7px",
            paddingLeft: "7px",
            fontFamily: "Arial",
            getPropertyValue: () => margin,
            content: "none",
          }) as unknown as CSSStyleDeclaration,
      );
      const capture = document.createElement("canvas");
      capture.width = 120;
      capture.height = 60;
      const capturePlan = planNativeCaptureRoi({
        ownBox: { x: 0, y: 0, width: 120, height: 60 },
        clipBox: {
          x,
          y: x,
          width,
          height: 60 - x * 2,
        },
        density: 1,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      expect(capturePlan.ok).toBe(true);
      if (capturePlan.ok) setNativeCaptureRoi(capture, capturePlan.plan);
      vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(capture);
      const provider = createNativeSceneProvider(target, "layer");
      try {
        const own = (await provider!.readScene()).find(
          (record) => record.node === target,
        );
        const outerOutset = edge === "border" ? outset : 0;
        expect(nativeTargetOverflowInsets(target)).toEqual({
          top: outerOutset,
          right: outerOutset,
          bottom: outerOutset,
          left: outerOutset,
        });
        expect(own).toMatchObject({
          kind: "dom",
          clip: {
            x: outerOutset > 0 ? -outerOutset : 0,
            y: outerOutset > 0 ? -outerOutset : 0,
            width: 120 + 2 * outerOutset,
            height: 60 + 2 * outerOutset,
          },
          groupClips: [],
        });
        const textClip = sourceClipPlan(
          target,
          target,
          "target-local",
          false,
          edge,
          outset,
        );
        expect(textClip.groupClips[0]?.clip.localBox.x).toBe(x);
        expect(textClip.groupClips[0]?.clip.localBox.width).toBe(width);
        const calls: string[] = [];
        const context = Object.fromEntries(
          [
            "save",
            "beginPath",
            "moveTo",
            "lineTo",
            "ellipse",
            "closePath",
            "clip",
          ].map((name) => [name, () => calls.push(name)]),
        ) as unknown as CanvasRenderingContext2D;
        expect(clipCanvasToOwnTextOverflow(target, context, 240, 120)).toBe(
          true,
        );
        expect(calls[0]).toBe("save");
        expect(calls[calls.length - 1]).toBe("clip");
        if (outset > 0 && capturePlan.ok) {
          const translations: Array<[number, number]> = [];
          const textContext = Object.fromEntries(
            [
              "save",
              "beginPath",
              "moveTo",
              "lineTo",
              "ellipse",
              "closePath",
              "clip",
            ].map((name) => [name, () => undefined]),
          ) as unknown as CanvasRenderingContext2D;
          textContext.translate = (x, y) => {
            translations.push([x, y]);
          };
          expect(
            clipCanvasToOwnTextOverflow(
              target,
              textContext,
              capturePlan.plan.pixelBox.width,
              capturePlan.plan.pixelBox.height,
              capturePlan.plan,
              1,
            ),
          ).toBe(true);
          const { x: offsetX, y: offsetY } = capturePlan.plan.pixelOffset;
          expect(translations).toEqual([
            [offsetX, offsetY],
            [-offsetX, -offsetY],
          ]);
          setNativeCaptureRoi(capture, {
            ...capturePlan.plan,
            cssBox: {
              ...capturePlan.plan.cssBox,
              x: capturePlan.plan.cssBox.x - 1,
            },
          });
          await expect(provider!.readScene()).rejects.toMatchObject({
            code: "source-capture-geometry-stale",
          });
        }
      } finally {
        provider?.dispose();
      }
    },
  );
});

describe("rounded source capture path", () => {
  it("keeps actual square corners when only one radius axis is zero", () => {
    const calls: Array<[string, ...number[]]> = [];
    const context = {
      beginPath: () => calls.push(["beginPath"]),
      moveTo: (x: number, y: number) => calls.push(["moveTo", x, y]),
      lineTo: (x: number, y: number) => calls.push(["lineTo", x, y]),
      ellipse: (...args: number[]) => calls.push(["ellipse", ...args]),
      closePath: () => calls.push(["closePath"]),
    } as unknown as CanvasRenderingContext2D;
    traceNativeRoundedBoxPath(
      context,
      { x: 10, y: 20, width: 100, height: 50 },
      {
        topLeft: { x: 0, y: 8 },
        topRight: { x: 8, y: 0 },
        bottomRight: { x: 8, y: 4 },
        bottomLeft: { x: 0, y: 0 },
      },
      2,
      3,
    );
    expect(calls).toEqual([
      ["beginPath"],
      ["moveTo", 20, 60],
      ["lineTo", 220, 60],
      ["lineTo", 220, 60],
      ["lineTo", 220, 198],
      ["ellipse", 204, 198, 16, 12, 0, 0, Math.PI / 2],
      ["lineTo", 20, 210],
      ["lineTo", 20, 210],
      ["lineTo", 20, 60],
      ["lineTo", 20, 60],
      ["closePath"],
    ]);
  });
});

describe("native replacement image sampling metadata", () => {
  function fixture(placement: "fill" | "layer", axis = 1) {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const parent = document.createElement("div");
    const receiver = document.createElement("div");
    const presentation = document.createElement("canvas");
    receiver.setAttribute(
      `data-an-native-${placement}-instance`,
      "sampling-output",
    );
    receiver.style.imageRendering = "auto";
    presentation.dataset.anNativeCanvas = "sampling-output";
    presentation.setAttribute("data-an-native-presentation", "");
    presentation.width = 32;
    presentation.height = 16;
    parent.append(receiver, presentation);
    document.body.append(parent);
    for (const element of [parent, receiver, presentation]) {
      Object.defineProperties(element, {
        offsetWidth: {
          configurable: true,
          value: element === parent ? 200 : 20,
        },
        offsetHeight: {
          configurable: true,
          value: element === parent ? 100 : 10,
        },
        offsetLeft: { configurable: true, value: element === parent ? 0 : 100 },
        offsetTop: { configurable: true, value: element === parent ? 0 : 20 },
      });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === parent) return new DOMRect(0, 0, 200, 100);
        if (this === receiver || this === presentation)
          return new DOMRect(
            axis < 0 ? 100 + axis * 20 : 100,
            20,
            Math.abs(axis) * 20,
            10,
          );
        return new DOMRect(0, 0, 0, 0);
      },
    );
    // happy-dom omits inherited image-rendering; supply the browser's computed keyword in this fixture.
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          imageRendering:
            element === presentation
              ? parent.classList.contains("sharp")
                ? "pixelated"
                : parent.classList.contains("crisp")
                  ? "crisp-edges"
                  : "auto"
              : "auto",
          display: "block",
          visibility: "visible",
          opacity: "1",
          position: element === presentation ? "absolute" : "static",
          transform:
            element === receiver || element === presentation
              ? `matrix(${axis}, 0, 0, 1, 0, 0)`
              : "none",
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
          content: "none",
          getPropertyValue: () => "0px",
        }) as unknown as CSSStyleDeclaration,
    );
    const provider = createNativeSceneProvider(parent, "layer");
    if (!provider) throw new Error("Source provider unavailable");
    return { parent, receiver, presentation, provider };
  }
  it.each(["fill", "layer"] as const)(
    "reads inherited %s presentation policy again after an ancestor class change",
    async (placement) => {
      const f = fixture(placement);
      try {
        const values: string[] = [];
        for (const className of ["", "sharp", "crisp", ""]) {
          f.parent.className = className;
          await mutationTurn();
          const records = await f.provider.readScene();
          const record = records.find(
            (entry) => entry.nativeInstanceId === "sampling-output",
          );
          expect(record).toMatchObject({
            imageRendering: {
              value:
                className === "sharp"
                  ? "pixelated"
                  : className === "crisp"
                    ? "crisp-edges"
                    : "auto",
            },
            width: 32,
            height: 16,
          });
          expect(record?.localBox).toEqual({
            x: 0,
            y: 0,
            width: 20,
            height: 10,
          });
          if (!record?.imageRendering)
            throw new Error("Native sampling metadata missing");
          values.push(record.imageRendering.value);
        }
        expect(values).toEqual(["auto", "pixelated", "crisp-edges", "auto"]);
        f.presentation.width = 48;
        f.presentation.height = 24;
        const record = (await f.provider.readScene()).find(
          (entry) => entry.nativeInstanceId === "sampling-output",
        );
        expect(record).toMatchObject({
          width: 48,
          height: 24,
          rect: { width: 20, height: 10 },
        });
      } finally {
        f.provider.dispose();
        f.parent.remove();
      }
    },
  );
  it.each([1.6, -1.6])(
    "retains physical source pixels under native Layer axis scale %s",
    async (axis) => {
      const f = fixture("layer", axis);
      f.parent.className = "sharp";
      try {
        const record = (await f.provider.readScene()).find(
          (entry) => entry.nativeInstanceId === "sampling-output",
        );
        expect(record).toMatchObject({
          width: 32,
          height: 16,
          imageRendering: { value: "pixelated" },
          localBox: { width: 20, height: 10 },
          localToTarget: { a: axis, b: 0, c: 0, d: 1 },
        });
        expect(record?.rect.width).toBeCloseTo(32, 5);
        if (!record?.localBox || !record.localToTarget)
          throw new Error("Native geometry missing");
        expect(
          planNativeImageSampling({
            imageRendering: record.imageRendering,
            sourceSize: { width: record.width, height: record.height },
            uploadedSize: { width: 32, height: 16 },
            localBox: record.localBox,
            localToTarget: record.localToTarget,
            physicalScale: { x: 1.6, y: 1.6 },
          }),
        ).toEqual({ ok: true, filter: "nearest", pixelated: { x: 2, y: 1 } });
      } finally {
        f.provider.dispose();
        f.parent.remove();
      }
    },
  );
  it("rejects zero original native canvas pixels without fabricating CSS dimensions", async () => {
    const f = fixture("layer");
    f.presentation.width = 0;
    try {
      await expect(f.provider.readScene()).rejects.toMatchObject({
        code: "source-image-rendering-geometry",
      });
    } finally {
      f.provider.dispose();
      f.parent.remove();
    }
  });
  it("retains the unique native presentation requirement", async () => {
    const f = fixture("layer");
    f.parent.append(f.presentation.cloneNode(true));
    try {
      await expect(f.provider.readScene()).rejects.toMatchObject({
        code: "native-presentation-missing",
      });
    } finally {
      f.provider.dispose();
      f.parent.remove();
    }
  });
});
