import { afterEach, describe, expect, it, vi } from "vitest";

import {
  centreSquare,
  createCompositor,
  segmentationInterval,
  smoothMask,
} from "./person-cutout";

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

  it("keeps the target free for Canvas 2D when WebGL setup fails", () => {
    vi.stubGlobal("document", { createElement: () => fakeCanvas() });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = fakeCanvas();

    const compositor = createCompositor(target as unknown as HTMLCanvasElement);

    expect(compositor).toBeDefined();
    expect(target.contexts).toEqual(["2d"]);
  });
});
