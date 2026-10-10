// @vitest-environment jsdom
import { CompressionStream as NodeCompressionStream } from "node:stream/web";

import { afterEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  hydrated: null as unknown,
  built: null as unknown,
}));

vi.mock("../../../shared/figma-svg-scene", () => ({
  collectRawFigmaSvgScene: () => ({ root: {} }),
  hydrateRawFigmaSvgNode: () => scene.hydrated,
  buildFigmaSvgDocument: ({ root }: { root: unknown }) => {
    scene.built = root;
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><text x="0" y="1">Vector title</text></svg>',
      report: { omitted: [] },
    };
  },
}));

import { buildNativeHybridSvgFromFrame } from "./native-hybrid-vector";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  scene.hydrated = null;
  scene.built = null;
});

function frame(overlap: boolean) {
  vi.stubGlobal("CompressionStream", NodeCompressionStream);
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  vi.spyOn(document.documentElement, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 8,
    bottom: 8,
    width: 8,
    height: 8,
  } as DOMRect);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 2,
    top: 2,
    right: 4,
    bottom: 4,
    width: 2,
    height: 2,
  } as DOMRect);
  scene.hydrated = {
    id: "root",
    kind: "box",
    rect: { x: 0, y: 0, width: 8, height: 8 },
    children: [
      { id: "title", kind: "text", rect: { x: 0, y: 0, width: 8, height: 1 } },
      {
        id: "unrenderable",
        kind: "raster",
        rect: overlap
          ? { x: 2, y: 2, width: 2, height: 2 }
          : { x: 5, y: 5, width: 2, height: 2 },
        raster: {
          href: "https://example.com/unreadable.png",
          reason: "unsupported",
        },
      },
    ],
  };
  return {
    document,
    viewport: { width: 8, height: 8 },
    pixelRatio: 1,
    pixels: {
      width: 8,
      height: 8,
      rgba: new Uint8Array(8 * 8 * 4),
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
    },
    runtimeCanvases: [canvas],
    signal: new AbortController().signal,
  };
}

describe("synchronized hybrid frame", () => {
  it("omits a covered unsupported source layer while retaining authored text", async () => {
    const output = await buildNativeHybridSvgFromFrame(frame(true));
    expect(output.rasterRegionCount).toBe(1);
    expect(output.svg).toContain("Vector title");
    expect(output.svg).not.toContain("unreadable.png");
    expect(scene.built).toMatchObject({
      children: [{ id: "title", kind: "text" }],
    });
  });

  it("rejects a source layer outside the native crop instead of omitting it", async () => {
    await expect(buildNativeHybridSvgFromFrame(frame(false))).rejects.toThrow(
      /outside the native effect regions/,
    );
  });
});
