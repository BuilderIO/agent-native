import { ImageSegmenter } from "@mediapipe/tasks-vision";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  centreSquare,
  createCompositor,
  createPersonCutout,
  segmentationInterval,
  smoothMask,
} from "./person-cutout";

vi.mock("@mediapipe/tasks-vision", () => ({
  ImageSegmenter: { createFromOptions: vi.fn() },
}));

describe("centreSquare", () => {
  it("crops the middle of a landscape frame", () => {
    expect(centreSquare(1920, 1080)).toEqual({ x: 420, y: 0, size: 1080 });
  });

  it("crops the middle of a portrait frame", () => {
    expect(centreSquare(720, 1280)).toEqual({ x: 0, y: 280, size: 720 });
  });
});

describe("smoothMask", () => {
  it("passes the first frame through, clamped to [0, 1]", () => {
    const confidence = new Float32Array([-0.2, 0, 0.5, 1, 1.4]);
    const state = new Float32Array(confidence.length);
    const out = new Uint8Array(confidence.length);

    smoothMask(confidence, state, out, false);

    expect(Array.from(out)).toEqual([0, 0, 128, 255, 255]);
    expect(state[2]).toBeCloseTo(0.5);
  });

  it("damps small changes to suppress edge flicker", () => {
    const state = new Float32Array([0.5]);
    const out = new Uint8Array(1);

    smoothMask(new Float32Array([0.6]), state, out, true);

    // weight = 0.35 + 0.1 * 4 = 0.75 → 0.5 + 0.1 * 0.75
    expect(state[0]).toBeCloseTo(0.575);
    expect(out[0]).toBe(Math.round(0.575 * 255));
  });

  it("follows large changes immediately to avoid ghosting", () => {
    const state = new Float32Array([0, 1]);
    const out = new Uint8Array(2);

    smoothMask(new Float32Array([1, 0]), state, out, true);

    expect(Array.from(out)).toEqual([255, 0]);
  });
});

describe("segmentationInterval", () => {
  it("runs at the maximum rate when inference is cheap", () => {
    expect(segmentationInterval(2, 30)).toBeCloseTo(1000 / 30);
  });

  it("backs off in proportion to inference cost", () => {
    expect(segmentationInterval(20, 30)).toBe(40);
  });

  it("never drops below the minimum rate", () => {
    expect(segmentationInterval(500, 30)).toBeCloseTo(1000 / 12);
  });

  it("respects a maximum rate below the minimum", () => {
    expect(segmentationInterval(500, 10)).toBe(100);
  });
});

describe("createCompositor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // WebGL2 context whose shader setup fails after the context exists.
  const brokenWebgl = () => ({
    VERTEX_SHADER: 0x8b31,
    createProgram: () => ({}),
    createShader: () => null,
    getExtension: () => null,
  });
  const canvas2d = () => ({
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  });
  const fakeCanvas = () => {
    const contexts: string[] = [];
    let locked: string | null = null;
    return {
      contexts,
      width: 0,
      height: 0,
      getContext(type: string) {
        contexts.push(type);
        // A canvas keeps the first context type it hands out.
        if (locked && locked !== type) return null;
        locked = type;
        return type === "webgl2" ? brokenWebgl() : canvas2d();
      },
    };
  };

  // WebGL2 context on which every call succeeds.
  const workingWebgl = (): unknown =>
    new Proxy(() => {}, { get: () => () => workingWebgl() });

  it("keeps the target free for Canvas 2D when WebGL setup fails", () => {
    vi.stubGlobal("document", { createElement: () => fakeCanvas() });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = fakeCanvas();

    const compositor = createCompositor(target as unknown as HTMLCanvasElement);

    expect(compositor).toBeDefined();
    expect(target.contexts).toEqual(["2d"]);
  });

  it("uses Canvas 2D when the target has no WebGL after the probe passed", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => workingWebgl() }),
    });
    const target = fakeCanvas();
    const getContext = target.getContext.bind(target);
    target.getContext = (type: string) =>
      type === "webgl2" ? (target.contexts.push(type), null) : getContext(type);

    const compositor = createCompositor(target as unknown as HTMLCanvasElement);

    expect(compositor).toBeDefined();
    expect(target.contexts).toContain("2d");
  });

  it("fails clearly when WebGL setup fails on the target after the probe passed", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => workingWebgl() }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = fakeCanvas();

    expect(() =>
      createCompositor(target as unknown as HTMLCanvasElement),
    ).toThrow("Canvas 2D is unavailable for the camera cut-out.");
  });

  it("rebinds its program, vertex array and textures on every draw", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => workingWebgl() }),
    });
    const calls: string[] = [];
    const recordingWebgl = (): unknown => {
      const gl: unknown = new Proxy(() => {}, {
        get: (_target, prop) => () => {
          calls.push(String(prop));
          return gl;
        },
      });
      return gl;
    };
    const target = { width: 0, height: 0, getContext: recordingWebgl };
    const compositor = createCompositor(target as unknown as HTMLCanvasElement);
    calls.length = 0;

    const maskFrame = {
      mask: new Uint8Array(1),
      guide: {} as HTMLCanvasElement,
    };
    const crop = { x: 0, y: 0, size: 8 };
    const source = {} as CanvasImageSource;
    compositor.draw(source, 8, 8, crop, 8, maskFrame, true, true);
    calls.length = 0;
    // A redraw without new data must not rely on bindings from creation.
    compositor.draw(source, 8, 8, crop, 8, maskFrame, false, false);

    const drawAt = calls.indexOf("drawArrays");
    expect(calls.indexOf("useProgram")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("useProgram")).toBeLessThan(drawAt);
    expect(calls.indexOf("bindVertexArray")).toBeLessThan(drawAt);
    expect(calls.filter((call) => call === "bindTexture")).toHaveLength(3);
    expect(calls).not.toContain("texImage2D");
  });
});

describe("createPersonCutout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("leaves the canvas untouched when aborted while loading", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => ({}) }),
    });
    const controller = new AbortController();
    const close = vi.fn();
    vi.mocked(ImageSegmenter.createFromOptions).mockImplementation(async () => {
      controller.abort();
      return { close } as unknown as ImageSegmenter;
    });
    const target = { getContext: vi.fn() };

    await expect(
      createPersonCutout({
        canvas: target as unknown as HTMLCanvasElement,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
    expect(target.getContext).not.toHaveBeenCalled();
  });
});
