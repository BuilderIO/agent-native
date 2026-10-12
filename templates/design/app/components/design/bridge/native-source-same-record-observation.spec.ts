// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyNativeSourceReadSceneMetrics } from "./native-mounted-benchmark";
import { createNativeSceneProvider } from "./native-source-provider";

const previousResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  document.body.replaceChildren();
  globalThis.ResizeObserver = previousResizeObserver;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function computedStyle(
  backgroundColor = "rgba(0, 0, 0, 0)",
  imageRendering = "auto",
) {
  return {
    imageRendering,
    objectFit: "fill",
    objectPosition: "50% 50%",
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
    backgroundColor,
    backgroundClip: "border-box",
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
    height: "60px",
    getPropertyValue: () => "0px",
  } as unknown as CSSStyleDeclaration;
}

describe("same-record source observations", () => {
  it.each([
    ["stable capture", "stable"],
    ["motion-only target movement", "target-motion"],
    ["motion-only ancestor movement", "ancestor-motion"],
    ["target resize", "target-resize"],
    ["ancestor clip change", "ancestor-clip"],
    ["image-rendering change", "image-rendering"],
  ] as const)(
    "keeps a coherent frame-start source for %s",
    async (_label, change) => {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as typeof ResizeObserver;

      const target = document.createElement("div");
      const image = document.createElement("img");
      image.src = "data:image/png;base64,AA==";
      let imageWidth = 20;
      Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, get: () => imageWidth },
        naturalHeight: { configurable: true, value: 10 },
      });
      target.append(image);
      document.body.append(target);

      const boxes = new Map<Element, DOMRect>([
        [document.documentElement, new DOMRect(0, 0, 400, 300)],
        [document.body, new DOMRect(0, 0, 400, 300)],
        [target, new DOMRect(10, 20, 200, 160)],
        [image, new DOMRect(20, 30, 100, 60)],
      ]);
      let imageOffsetLeftReads = 0;
      for (const element of [
        document.documentElement,
        document.body,
        target,
        image,
      ]) {
        Object.defineProperties(element, {
          getBoundingClientRect: {
            configurable: true,
            value: () => boxes.get(element) ?? new DOMRect(0, 0, 0, 0),
          },
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
            get: () => {
              if (element === image) imageOffsetLeftReads += 1;
              return boxes.get(element)?.x ?? 0;
            },
          },
          offsetTop: {
            configurable: true,
            get: () => boxes.get(element)?.y ?? 0,
          },
        });
      }

      const imageStyleReads: string[] = [];
      let imageRendering = "auto";
      let targetOverflow = "visible";
      vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
        const style = computedStyle(
          element === image ? "rgb(20, 30, 40)" : undefined,
          element === image ? imageRendering : undefined,
        );
        if (element === image)
          Object.defineProperty(style, "imageRendering", {
            configurable: true,
            get: () => imageRendering,
          });
        if (element === target)
          style.overflowX = style.overflowY = targetOverflow;
        if (element === image) imageStyleReads.push(new Error().stack ?? "");
        return style;
      });

      let styleReadsAtRasterFill = 0;
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        function (this: HTMLCanvasElement) {
          return {
            save() {},
            scale() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            ellipse() {},
            closePath() {},
            fill() {
              styleReadsAtRasterFill = imageStyleReads.length;
              if (change === "target-motion") {
                boxes.set(image, new DOMRect(45, 55, 100, 60));
              } else if (change === "ancestor-motion") {
                boxes.set(target, new DOMRect(30, 20, 200, 160));
                boxes.set(image, new DOMRect(40, 30, 100, 60));
              } else if (change === "target-resize") {
                boxes.set(target, new DOMRect(10, 20, 220, 160));
              } else if (change === "ancestor-clip") {
                targetOverflow = "hidden";
              } else if (change === "image-rendering") {
                imageRendering = "pixelated";
                imageWidth = 40;
              }
            },
            restore() {},
            set fillStyle(_value: string) {},
          } as unknown as CanvasRenderingContext2D;
        },
      );

      const provider = createNativeSceneProvider(target, "layer");
      expect(provider).not.toBeNull();
      try {
        const metrics = emptyNativeSourceReadSceneMetrics();
        if (change === "stable") {
          const records = await provider!.readScene(metrics);
          const imageRecord = records.find((record) => record.kind === "image");
          expect(imageStyleReads.length).toBeGreaterThan(
            styleReadsAtRasterFill,
          );
          expect(styleReadsAtRasterFill).toBe(11);
          expect(metrics.recordDirectStyleReads).toBe(8);
          expect(imageOffsetLeftReads).toBe(3);
          expect(imageRecord).toMatchObject({
            kind: "image",
            source: image,
            width: 20,
            height: 10,
            rect: { x: 10, y: 10, width: 100, height: 60 },
            imageRendering: { value: "auto" },
          });
        } else {
          const records = await provider!.readScene(metrics);
          const imageRecord = records.find((record) => record.kind === "image");
          expect(imageRecord).toMatchObject({
            kind: "image",
            width: 20,
            height: 10,
            rect: { x: 10, y: 10, width: 100, height: 60 },
            imageRendering: { value: "auto" },
          });
        }
      } finally {
        provider?.dispose();
      }
    },
  );

  it("keeps the captured frame-start geometry while CSS motion advances during decode", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;

    const target = document.createElement("div");
    const card = document.createElement("div");
    const insertedImage = document.createElement("img");
    insertedImage.src = "data:image/png;base64,AA==";
    Object.defineProperties(insertedImage, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 20 },
      naturalHeight: { configurable: true, value: 10 },
    });
    target.append(card);
    document.body.append(target);

    const boxes = new Map<Element, DOMRect>([
      [document.documentElement, new DOMRect(0, 0, 400, 300)],
      [document.body, new DOMRect(0, 0, 400, 300)],
      [target, new DOMRect(10, 20, 200, 120)],
      [card, new DOMRect(30, 35, 80, 40)],
    ]);
    for (const element of [
      document.documentElement,
      document.body,
      target,
      card,
      insertedImage,
    ]) {
      Object.defineProperties(element, {
        getBoundingClientRect: {
          configurable: true,
          value: () => boxes.get(element) ?? new DOMRect(0, 0, 0, 0),
        },
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
          get: () =>
            element === target
              ? 10
              : element === card
                ? 30
                : element === insertedImage
                  ? 80
                  : 0,
        },
        offsetTop: {
          configurable: true,
          get: () =>
            element === target
              ? 20
              : element === card
                ? 35
                : element === insertedImage
                  ? 45
                  : 0,
        },
      });
    }

    let targetOverflow = "visible";
    let cardTransform = "none";
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computedStyle(
        element === card ? "rgb(20, 30, 40)" : "rgba(0, 0, 0, 0)",
      );
      if (element === target) {
        Object.defineProperties(style, {
          overflowX: { configurable: true, get: () => targetOverflow },
          overflowY: { configurable: true, get: () => targetOverflow },
        });
      }
      if (element === card)
        Object.defineProperty(style, "transform", {
          configurable: true,
          get: () => cardTransform,
        });
      return style;
    });

    let beginDecode!: () => void;
    let releaseDecode!: () => void;
    const decodeStarted = new Promise<void>((resolve) => {
      beginDecode = resolve;
    });
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    class DeferredImage {
      src = "";
      async decode() {
        beginDecode();
        await decodeGate;
      }
    }
    vi.stubGlobal("Image", DeferredImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect() {},
      drawImage() {},
      save() {},
      restore() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      ellipse() {},
      closePath() {},
      fill() {},
      set fillStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D);

    const provider = createNativeSceneProvider(target, "layer");
    expect(provider).not.toBeNull();
    try {
      const pending = provider!.readScene();
      await decodeStarted;
      boxes.set(target, new DOMRect(20, 20, 220, 120));
      boxes.set(card, new DOMRect(55, 35, 80, 40));
      boxes.set(insertedImage, new DOMRect(80, 45, 20, 10));
      target.append(insertedImage);
      targetOverflow = "hidden";
      cardTransform = "matrix(1, 0, 0, 1, 25, 0)";
      releaseDecode();

      const records = await pending;
      const record = records.find((candidate) => candidate.node === card);
      expect(record).toMatchObject({
        kind: "dom",
        rect: { x: 20, y: 15, width: 80, height: 40 },
        clip: { x: 0, y: 0, width: 200, height: 120 },
      });
      expect(
        records.find((candidate) => candidate.node === insertedImage),
      ).toMatchObject({ kind: "image", width: 20, height: 10 });
      const nextFrame = await provider!.readScene();
      expect(
        nextFrame.find((candidate) => candidate.node === card),
      ).toMatchObject({
        kind: "dom",
        rect: { x: 45, y: 15, width: 80, height: 40 },
        clip: { x: 0, y: 0, width: 220, height: 120 },
      });
    } finally {
      releaseDecode();
      provider?.dispose();
    }
  });

  it("fingerprints only the box nodes captured for ordinary own paint", async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;

    const target = document.createElement("div");
    target.append(document.createElement("section"));
    let parent = target.firstElementChild!;
    for (let index = 0; index < 12; index += 1) {
      const child = document.createElement("div");
      parent.append(child);
      parent = child;
    }
    document.body.append(target);
    for (const element of [document.documentElement, document.body, target])
      Object.defineProperties(element, {
        getBoundingClientRect: {
          configurable: true,
          value: () => new DOMRect(0, 0, 160, 90),
        },
        offsetWidth: { configurable: true, get: () => 160 },
        offsetHeight: { configurable: true, get: () => 90 },
        offsetLeft: { configurable: true, get: () => 0 },
        offsetTop: { configurable: true, get: () => 0 },
      });

    let descendantColorReads = 0;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computedStyle(
        element === target ? "rgb(20, 30, 40)" : "rgba(0, 0, 0, 0)",
      );
      Object.defineProperty(style, "color", {
        configurable: true,
        get() {
          if (element !== target) descendantColorReads += 1;
          return "rgb(1, 2, 3)";
        },
      });
      return style;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect() {},
      drawImage() {},
      save() {},
      restore() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      ellipse() {},
      closePath() {},
      fill() {},
      set fillStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D);

    const provider = createNativeSceneProvider(target, "layer");
    expect(provider).not.toBeNull();
    try {
      const records = await provider!.readScene();
      expect(records.some((record) => record.node === target)).toBe(true);
      expect(descendantColorReads).toBe(0);
    } finally {
      provider?.dispose();
    }
  });
});
