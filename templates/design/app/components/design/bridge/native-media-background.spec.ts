// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { planNativeSourceComposition } from "../../../../shared/native-source-composition-tree";
import { createNativeSceneProvider } from "./native-source-provider";

const originalAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "getAnimations",
);
const originalCanvas = HTMLCanvasElement.prototype.getContext;
const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  document.body.replaceChildren();
  if (originalAnimations)
    Object.defineProperty(
      Element.prototype,
      "getAnimations",
      originalAnimations,
    );
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
  HTMLCanvasElement.prototype.getContext = originalCanvas;
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

function scene(
  background: () => string,
  border: () => string,
  paddedClip = false,
  replacedClip = false,
  ancestorContentClip = false,
) {
  const target = document.createElement("div");
  const image = document.createElement("img");
  image.src = "/owned-transparent.png";
  target.append(image);
  document.body.append(target);
  target.getBoundingClientRect = () =>
    new DOMRect(0, 0, paddedClip ? 100 : 200, 100);
  image.getBoundingClientRect = () =>
    new DOMRect(paddedClip ? 80 : 0, 0, paddedClip ? 100 : 200, 100);
  Object.defineProperties(target, {
    offsetWidth: { configurable: true, value: paddedClip ? 100 : 200 },
    offsetHeight: { configurable: true, value: 100 },
  });
  Object.defineProperties(image, {
    offsetLeft: { configurable: true, value: paddedClip ? 80 : 0 },
    offsetTop: { configurable: true, value: 0 },
    offsetWidth: { configurable: true, value: paddedClip ? 100 : 200 },
    offsetHeight: { configurable: true, value: 100 },
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 100 },
    naturalHeight: { configurable: true, value: 100 },
  });
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as typeof ResizeObserver;
  const paints: string[] = [];
  HTMLCanvasElement.prototype.getContext = function () {
    let fillStyle = "";
    return {
      save() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      ellipse() {},
      closePath() {},
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      fill() {
        paints.push(fillStyle);
      },
      restore() {},
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (pseudo) return { content: "none" } as CSSStyleDeclaration;
    const media = element === image;
    return {
      display: "block",
      visibility: "visible",
      opacity: media ? "0.5" : "1",
      mixBlendMode: "normal",
      filter: "none",
      backdropFilter: "none",
      transform: "none",
      transformOrigin: "50% 50%",
      perspective: "none",
      transformStyle: "flat",
      rotate: "none",
      scale: "none",
      position: "static",
      isolation: "auto",
      zIndex: "auto",
      backgroundImage: "none",
      backgroundColor: media ? background() : "rgba(0, 0, 0, 0)",
      backgroundClip: "border-box",
      boxShadow: "none",
      outlineStyle: "none",
      borderTopWidth: media ? border() : "0px",
      borderRightWidth: media ? border() : "0px",
      borderBottomWidth: media ? border() : "0px",
      borderLeftWidth: media ? border() : "0px",
      borderTopLeftRadius: media ? "20px" : "0px",
      borderTopRightRadius: media ? "20px" : "0px",
      borderBottomRightRadius: media ? "20px" : "0px",
      borderBottomLeftRadius: media ? "20px" : "0px",
      paddingTop: "0px",
      paddingRight:
        media && paddedClip
          ? "40px"
          : element === target && ancestorContentClip
            ? "30px"
            : "0px",
      paddingBottom: "0px",
      paddingLeft:
        media && paddedClip
          ? "40px"
          : element === target && ancestorContentClip
            ? "30px"
            : "0px",
      objectFit: "contain",
      objectPosition: "50% 50%",
      overflowX:
        element === target && (paddedClip || ancestorContentClip)
          ? ancestorContentClip
            ? "clip"
            : "hidden"
          : media && replacedClip
            ? "clip"
            : "visible",
      overflowY:
        element === target && (paddedClip || ancestorContentClip)
          ? ancestorContentClip
            ? "clip"
            : "hidden"
          : media && replacedClip
            ? "clip"
            : "visible",
      maskImage: "none",
      clipPath: "none",
      getPropertyValue: () =>
        (media && replacedClip) || (element === target && ancestorContentClip)
          ? "content-box"
          : "0px",
    } as unknown as CSSStyleDeclaration;
  });
  return { target, image, paints };
}

describe("native media solid background", () => {
  it("paints transparent-image letterbox behind contained media with shared group opacity", async () => {
    let background = "rgb(200, 0, 0)";
    const { target, image, paints } = scene(
      () => background,
      () => "0px",
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      const records = await provider.readScene();
      expect(records.map((record) => record.kind)).toEqual(["dom", "image"]);
      expect(records[0].source).toBeInstanceOf(HTMLCanvasElement);
      expect(records[0].rect).toMatchObject({ x: 0, width: 200 });
      expect(records[1].rect).toMatchObject({ x: 50, width: 100 });
      expect(records[0].clips).toHaveLength(0);
      expect(records[1].clips[0].radii.topLeft).toEqual({ x: 20, y: 20 });
      expect(records.map((record) => record.node)).toEqual([image, image]);
      expect(paints).toEqual(["rgb(200, 0, 0)"]);
      const planned = planNativeSourceComposition(
        records.map((record) => ({
          id: `leaf:${record.key}`,
          box: record.rect,
          opacity: record.opacity,
          isolationPath: record.isolationPath,
        })),
      );
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const group = planned.root.children[0];
      expect(group).toMatchObject({
        kind: "group",
        isolationKind: "opacity",
        opacity: 0.5,
        children: [{ kind: "leaf" }, { kind: "leaf" }],
      });
      if (group.kind !== "group") return;
      const sample = (x: number, imageAlpha: number) => {
        const boxCovers =
          x >= records[0].rect.x &&
          x < records[0].rect.x + records[0].rect.width;
        const imageCovers =
          x >= records[1].rect.x &&
          x < records[1].rect.x + records[1].rect.width;
        const boxAlpha = boxCovers ? 1 : 0;
        const mediaAlpha = imageCovers ? imageAlpha : 0;
        const opacity = group.opacity;
        return {
          red: 200 * boxAlpha * (1 - mediaAlpha) * opacity,
          blue: 200 * mediaAlpha * opacity,
          alpha: (mediaAlpha + boxAlpha * (1 - mediaAlpha)) * opacity,
        };
      };
      expect(sample(25, 1)).toEqual({ red: 100, blue: 0, alpha: 0.5 });
      expect(sample(100, 0)).toEqual({ red: 100, blue: 0, alpha: 0.5 });
      expect(sample(100, 1)).toEqual({ red: 0, blue: 100, alpha: 0.5 });
      expect(provider.captureCount()).toBe(1);
      await provider.readScene();
      expect(provider.captureCount()).toBe(1);
      background = "rgb(0, 0, 200)";
      provider.invalidate();
      await provider.readScene();
      expect(paints).toEqual(["rgb(200, 0, 0)", "rgb(0, 0, 200)"]);
    } finally {
      provider.dispose();
    }
  });

  it("continues to reject media borders rather than silently dropping them", async () => {
    const { target } = scene(
      () => "rgb(200, 0, 0)",
      () => "2px",
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      await expect(provider.readScene()).rejects.toMatchObject({
        code: "source-media-own-paint-unsupported",
      });
    } finally {
      provider.dispose();
    }
  });

  it("accepts the UA content-box overflow edge of replaced media", async () => {
    const { target, image } = scene(
      () => "rgba(0, 0, 0, 0)",
      () => "0px",
      false,
      true,
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      const records = await provider.readScene();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ kind: "image", node: image });
    } finally {
      provider.dispose();
    }
  });

  it("does not reject a native presentation canvas with the UA content-box default", async () => {
    const { target, image } = scene(
      () => "rgba(0, 0, 0, 0)",
      () => "0px",
    );
    image.remove();
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-an-native-canvas", "earlier-native-effect");
    canvas.width = 200;
    canvas.height = 100;
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    Object.defineProperties(canvas, {
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 100 },
    });
    target.append(canvas);
    const baseStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation()!;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = baseStyle(element, pseudo);
        if (element !== canvas || pseudo) return style;
        return {
          ...style,
          overflowX: "clip",
          overflowY: "clip",
          getPropertyValue: () => "content-box",
        } as CSSStyleDeclaration;
      },
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      await expect(provider.readScene()).resolves.toEqual([
        expect.objectContaining({
          kind: "native",
          node: canvas,
          nativeInstanceId: "earlier-native-effect",
        }),
      ]);
    } finally {
      provider.dispose();
    }
  });

  it("clips descendant media at an ancestor content edge when padding is nonzero", async () => {
    const { target, image } = scene(
      () => "rgba(0, 0, 0, 0)",
      () => "0px",
      false,
      false,
      true,
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      const records = await provider.readScene();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        kind: "image",
        node: image,
        clip: { x: 30, width: 140 },
      });
      expect(records[0].groupClips[0].clip.rect).toMatchObject({
        x: 30,
        width: 140,
      });
    } finally {
      provider.dispose();
    }
  });

  it("retains a visible padding-box background when ancestor clipping removes all media pixels", async () => {
    const { target, image, paints } = scene(
      () => "rgb(200, 0, 0)",
      () => "0px",
      true,
    );
    const provider = createNativeSceneProvider(target, "layer")!;
    try {
      const records = await provider.readScene();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        kind: "dom",
        node: image,
        rect: { x: 80, width: 100 },
        clip: { x: 0, width: 100 },
      });
      expect(paints).toEqual(["rgb(200, 0, 0)"]);
      expect(records[0].isolationPath).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "clip" }),
          expect.objectContaining({ kind: "opacity", opacity: 0.5 }),
        ]),
      );
    } finally {
      provider.dispose();
    }
  });
});
