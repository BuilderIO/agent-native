// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { nativeShaderRuntimeBridgeScript } from "../../../../.generated/bridge/native-shader-runtime.generated";

type Runtime = {
  scan(): Promise<void>;
  renderCompositionFrame(options: {
    frameIndex: number;
    fps: number;
    sourceContract: "declarative-only";
  }): Promise<{
    timeSeconds: number;
    value: { rendered: number; failures: unknown[] };
  }>;
  renderCompositionFramePixels(options: {
    frameIndex: number;
    fps: number;
    sourceContract: "declarative-only";
    pixelRatio: number;
    viewport: { width: number; height: number };
  }): Promise<{ rgba: Uint8Array }>;
  dispose(): void;
};

const ownedScripts: HTMLScriptElement[] = [];
let runtime: Runtime | undefined;
let currentScript: PropertyDescriptor | undefined;
let fonts: PropertyDescriptor | undefined;
let animations: PropertyDescriptor | undefined;

afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
  for (const script of ownedScripts.splice(0)) script.remove();
  if (currentScript)
    Object.defineProperty(document, "currentScript", currentScript);
  else Reflect.deleteProperty(document, "currentScript");
  if (fonts) Object.defineProperty(document, "fonts", fonts);
  else Reflect.deleteProperty(document, "fonts");
  if (animations) Object.defineProperty(document, "getAnimations", animations);
  else Reflect.deleteProperty(document, "getAnimations");
});

describe("native runtime composition-frame integration", () => {
  it("runs a declarative document without GPU effects and rejects unknown executable scripts", async () => {
    currentScript = Object.getOwnPropertyDescriptor(document, "currentScript");
    fonts = Object.getOwnPropertyDescriptor(document, "fonts");
    animations = Object.getOwnPropertyDescriptor(document, "getAnimations");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        status: "loaded",
        addEventListener() {},
        removeEventListener() {},
      },
    });
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    const script = document.createElement("script");
    document.body.append(script);
    ownedScripts.push(script);
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });
    new Function(nativeShaderRuntimeBridgeScript)();
    runtime = (window as Window & { __anNativeShaders?: Runtime })
      .__anNativeShaders;
    expect(runtime).toBeDefined();
    await runtime!.scan();
    const result = await runtime!.renderCompositionFrame({
      frameIndex: 12,
      fps: 24,
      sourceContract: "declarative-only",
    });
    expect(result).toMatchObject({
      timeSeconds: 0.5,
      value: { rendered: 0, failures: [] },
    });

    const originalBounds = document.documentElement.getBoundingClientRect;
    const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const originalHeight = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    document.documentElement.getBoundingClientRect = () =>
      new DOMRect(0, 0, 20, 20);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 20,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 20,
    });
    try {
      await expect(
        runtime!.renderCompositionFramePixels({
          frameIndex: 14,
          fps: 24,
          pixelRatio: 1,
          viewport: { width: 20, height: 20 },
          sourceContract: "declarative-only",
        }),
      ).rejects.toMatchObject({ code: "webgpu-unavailable" });
      const afterFailure = await runtime!.renderCompositionFrame({
        frameIndex: 15,
        fps: 24,
        sourceContract: "declarative-only",
      });
      expect(afterFailure.value.failures).toEqual([]);
    } finally {
      document.documentElement.getBoundingClientRect = originalBounds;
      if (originalWidth)
        Object.defineProperty(window, "innerWidth", originalWidth);
      else Reflect.deleteProperty(window, "innerWidth");
      if (originalHeight)
        Object.defineProperty(window, "innerHeight", originalHeight);
      else Reflect.deleteProperty(window, "innerHeight");
    }

    const unknown = document.createElement("script");
    document.head.append(unknown);
    ownedScripts.push(unknown);
    // A script inserted during a held frame is a separate cancellation case.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      runtime!.renderCompositionFrame({
        frameIndex: 13,
        fps: 24,
        sourceContract: "declarative-only",
      }),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });
  });
});
