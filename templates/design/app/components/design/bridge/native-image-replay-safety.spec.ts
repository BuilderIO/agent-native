// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyNativeImageReplaySafety } from "./native-image-replay-safety";
import {
  createNativeSceneProvider,
  type NativeSourceRecord,
} from "./native-source-provider";

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("captured image replay safety", () => {
  it("distinguishes still PNG from APNG and malformed or unclassified data", () => {
    expect(classifyNativeImageReplaySafety(png)).toBe("immutable");
    const idat = png.findIndex(
      (_byte, index) =>
        index >= 4 &&
        String.fromCharCode(...png.subarray(index - 4, index)) === "IDAT",
    );
    expect(idat).toBeGreaterThan(0);
    const animation = new Uint8Array(20);
    animation.set([0, 0, 0, 8], 0);
    animation.set([97, 99, 84, 76], 4);
    const apng = new Uint8Array(png.length + animation.length);
    apng.set(png.subarray(0, idat - 8));
    apng.set(animation, idat - 8);
    apng.set(png.subarray(idat - 8), idat - 8 + animation.length);
    expect(classifyNativeImageReplaySafety(apng)).toBe("dynamic");
    expect(classifyNativeImageReplaySafety(png.subarray(0, 24))).toBe(
      "unknown",
    );
    expect(classifyNativeImageReplaySafety(new Uint8Array([0, 1, 2]))).toBe(
      "unknown",
    );
  });

  it("recognizes static JPEG and WebP while rejecting animation flags", () => {
    expect(
      classifyNativeImageReplaySafety(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]),
      ),
    ).toBe("immutable");
    const webp = new Uint8Array([
      82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 10, 0, 0, 0,
      0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0,
    ]);
    expect(classifyNativeImageReplaySafety(webp)).toBe("immutable");
    const animated = new Uint8Array(30);
    animated.set(new TextEncoder().encode("RIFF"), 0);
    animated[4] = 22;
    animated.set(new TextEncoder().encode("WEBPVP8X"), 8);
    animated[16] = 10;
    animated[20] = 0x02;
    expect(classifyNativeImageReplaySafety(animated)).toBe("dynamic");
    expect(
      classifyNativeImageReplaySafety(new TextEncoder().encode("<svg/>")),
    ).toBe("unknown");
  });

  it("accepts bounded primitive SVG images and leaves animated or malformed SVG unknown", () => {
    const encode = (source: string) => new TextEncoder().encode(source);
    const head =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" role="img" aria-label="landscape">';
    expect(
      classifyNativeImageReplaySafety(
        encode(
          `${head}<rect width="800" height="560" fill="#101525"/><circle cx="570" cy="182" r="116" fill="#fff9e8"/><path d="M0 308 166 157 310 324Z" fill="#10d7de"/></svg>`,
        ),
        "image/svg+xml",
      ),
    ).toBe("immutable");
    expect(
      classifyNativeImageReplaySafety(
        encode(
          `${head}<defs><linearGradient id="sky"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/></linearGradient><clipPath id="edge"><rect width="800" height="560"/></clipPath></defs><g clip-path="url(#edge)"><rect width="800" height="560" fill="url(#sky)"/></g></svg>`,
        ),
        "image/svg+xml",
      ),
    ).toBe("immutable");
    expect(
      classifyNativeImageReplaySafety(
        encode(
          `${head}<circle r="5"><animate attributeName="r" values="5;10" dur="1s" repeatCount="indefinite"/></circle></svg>`,
        ),
        "image/svg+xml",
      ),
    ).toBe("unknown");
    expect(
      classifyNativeImageReplaySafety(
        encode(
          `${head}<rect width="10" height="10" fill="url(https://example.test/image.svg#paint)"/></svg>`,
        ),
        "image/svg+xml",
      ),
    ).toBe("unknown");
    expect(
      classifyNativeImageReplaySafety(
        encode(
          `${head}<defs><clipPath id="edge"><rect width="10" height="10"/></clipPath></defs><rect width="10" height="10" fill="url(#edge)"/></svg>`,
        ),
        "image/svg+xml",
      ),
    ).toBe("unknown");
    expect(
      classifyNativeImageReplaySafety(
        encode(`${head}<path></svg>`),
        "image/svg+xml",
      ),
    ).toBe("unknown");
  });
});

describe("scene capture replay safety", () => {
  it("requires an actual current read and rejects invalidated or animated scenes", async () => {
    const previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    document.body.append(target);
    const style = {
      display: "block",
      visibility: "visible",
      opacity: "1",
      position: "static",
      zIndex: "auto",
      order: "0",
      isolation: "auto",
      mixBlendMode: "normal",
      filter: "none",
      backdropFilter: "none",
      transform: "none",
      transformOrigin: "0px 0px",
      translate: "none",
      rotate: "none",
      scale: "none",
      perspective: "none",
      transformStyle: "flat",
      overflowX: "visible",
      overflowY: "visible",
      clipPath: "none",
      backgroundImage: "none",
      backgroundColor: "transparent",
      backgroundClip: "border-box",
      boxShadow: "none",
      outlineStyle: "none",
      maskImage: "none",
      borderImageSource: "none",
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
      imageRendering: "auto",
      objectFit: "fill",
      objectPosition: "50% 50%",
      length: 0,
      item: () => null,
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(window, "getComputedStyle").mockReturnValue(style);
    const provider = createNativeSceneProvider(target, "layer");
    expect(provider).not.toBeNull();
    try {
      expect(await provider!.replaySafety([])).toBe("unknown");
      const captured = await provider!.readScene();
      expect(captured).toEqual([]);
      expect(await provider!.replaySafety(captured)).toBe("immutable");
      captured.push({ kind: "native" } as NativeSourceRecord);
      expect(await provider!.replaySafety(captured)).toBe("dynamic");
      expect(await provider!.replaySafety(captured, "committed-native")).toBe(
        "immutable",
      );
      captured.pop();
      Object.defineProperty(target, "getAnimations", {
        configurable: true,
        value: () => [{ playState: "running" }],
      });
      expect(await provider!.replaySafety(captured)).toBe("dynamic");
      Object.defineProperty(target, "getAnimations", {
        configurable: true,
        value: () => [],
      });
      provider!.invalidate();
      expect(await provider!.replaySafety(captured)).toBe("unknown");
    } finally {
      provider!.dispose();
      globalThis.ResizeObserver = previousResizeObserver;
    }
  });

  it("classifies a loaded authored PNG from the captured image record", async () => {
    const previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const target = document.createElement("div");
    const image = document.createElement("img");
    image.src = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    target.append(image);
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
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
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
      mixBlendMode: "normal",
      filter: "none",
      backdropFilter: "none",
      backgroundImage: "none",
      backgroundColor: "transparent",
      borderImageSource: "none",
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
    } as unknown as CSSStyleDeclaration);
    const provider = createNativeSceneProvider(target, "layer");
    try {
      const records = await provider!.readScene();
      expect(records).toMatchObject([
        { kind: "image", imageSourceUrl: image.src },
      ]);
      expect(await provider!.replaySafety(records)).toBe("immutable");
    } finally {
      provider?.dispose();
      globalThis.ResizeObserver = previousResizeObserver;
    }
  });
});
