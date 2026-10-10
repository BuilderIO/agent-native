// @vitest-environment jsdom
import { CompressionStream as NodeCompressionStream } from "node:stream/web";
import { inflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assembleNativeHybridSvg,
  hybridRectCovered,
  nativeHybridViewportBackground,
  planHybridRasterRegions,
} from "./native-hybrid-vector";

function decodeRgbaPng(data: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const compressed: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset < data.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    expect(offset + 12 + length).toBeLessThanOrEqual(data.byteLength);
    if (type === "IHDR") {
      width = new DataView(
        body.buffer,
        body.byteOffset,
        body.byteLength,
      ).getUint32(0);
      height = new DataView(
        body.buffer,
        body.byteOffset,
        body.byteLength,
      ).getUint32(4);
      expect(body[9]).toBe(6);
      expect(body[10]).toBe(0);
    } else if (type === "IDAT") {
      compressed.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  expect(compressed.length).toBeGreaterThan(0);
  const encoded = inflateSync(
    Buffer.concat(compressed.map((part) => Buffer.from(part))),
  );
  const stride = width * 4;
  expect(encoded.byteLength).toBe(height * (stride + 1));
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (stride + 1);
    expect(encoded[rowStart]).toBe(0);
    rgba.set(
      encoded.subarray(rowStart + 1, rowStart + 1 + stride),
      row * stride,
    );
  }
  return { width, height, rgba };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native hybrid vector export", () => {
  it("partitions overlapping shader regions into disjoint pixels while leaving the remaining page vector", () => {
    const planned = planHybridRasterRegions({
      bounds: [
        { left: 10, top: 10, right: 60, bottom: 60 },
        { left: 40, top: 40, right: 90, bottom: 90 },
      ],
      width: 100,
      height: 100,
      pixelRatio: 1,
    });
    const rasterArea = planned.raster.reduce(
      (area, rect) => area + (rect.x1 - rect.x0) * (rect.y1 - rect.y0),
      0,
    );
    const vectorArea = planned.vector.reduce(
      (area, rect) => area + (rect.x1 - rect.x0) * (rect.y1 - rect.y0),
      0,
    );
    expect(rasterArea).toBe(4_600);
    expect(vectorArea).toBe(5_400);
    expect(
      hybridRectCovered({ x0: 45, y0: 45, x1: 55, y1: 55 }, planned.raster),
    ).toBe(true);
    expect(
      hybridRectCovered({ x0: 0, y0: 0, x1: 20, y1: 20 }, planned.raster),
    ).toBe(false);
  });

  it("uses the CSS canvas background across viewport rows below a short authored body", () => {
    const root = document.documentElement;
    const body = document.body;
    const previousRoot = root.getAttribute("style");
    const previousBody = body.getAttribute("style");
    try {
      root.style.backgroundColor = "rgb(246, 240, 231)";
      root.style.backgroundImage = "none";
      body.style.backgroundColor = "rgb(48, 43, 58)";
      body.style.backgroundImage = "none";
      expect(nativeHybridViewportBackground(document)).toBe(
        "rgb(246, 240, 231)",
      );
      root.style.backgroundColor = "transparent";
      body.style.backgroundColor = "rgb(246, 240, 231)";
      expect(nativeHybridViewportBackground(document)).toBe(
        "rgb(246, 240, 231)",
      );
      body.style.backgroundImage = "linear-gradient(red, blue)";
      expect(() => nativeHybridViewportBackground(document)).toThrow(
        /cannot be preserved/,
      );
    } finally {
      if (previousRoot === null) root.removeAttribute("style");
      else root.setAttribute("style", previousRoot);
      if (previousBody === null) body.removeAttribute("style");
      else body.setAttribute("style", previousBody);
    }
  });

  it("keeps vector text and embeds exact straight-alpha crop bytes at the planned coordinates", async () => {
    vi.stubGlobal("CompressionStream", NodeCompressionStream);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("Hybrid crops must not pass through Canvas2D");
      },
    );
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        rgba.set(
          [x * 23 + 1, y * 29 + 2, (x + y) * 11 + 3, (x + y) * 17],
          index,
        );
      }
    }
    rgba.set([187, 83, 41, 167], (2 * 8 + 2) * 4);
    rgba.set([233, 19, 77, 0], (2 * 8 + 3) * 4);
    const regions = planHybridRasterRegions({
      bounds: [{ left: 2, top: 2, right: 4, bottom: 4 }],
      width: 8,
      height: 8,
      pixelRatio: 1,
    });
    const svg = await assembleNativeHybridSvg({
      vectorSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><defs><clipPath id="native-vector-unaffected"><rect width="1" height="1"/></clipPath></defs><text x="0" y="1">Editable</text><rect x="0" y="0" width="8" height="8"/></svg>',
      width: 8,
      height: 8,
      pixelRatio: 1,
      rgba,
      regions,
      viewportBackgroundColor: "rgb(246, 240, 231)",
      signal: new AbortController().signal,
    });
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("text")?.textContent).toBe("Editable");
    expect(parsed.querySelector("g[clip-path]")).not.toBeNull();
    expect(
      parsed.querySelector("g[clip-path]")?.getAttribute("clip-path"),
    ).toBe("url(#native-vector-unaffected-1)");
    expect(parsed.querySelectorAll("clipPath rect").length).toBeGreaterThan(0);
    const images = parsed.querySelectorAll("image");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("x")).toBe("2");
    expect(images[0]?.getAttribute("y")).toBe("2");
    expect(images[0]?.getAttribute("width")).toBe("2");
    expect(images[0]?.getAttribute("height")).toBe("2");
    const href = images[0]?.getAttribute("href");
    expect(href).toMatch(/^data:image\/png;base64,/);
    const decoded = decodeRgbaPng(Buffer.from(href!.split(",")[1]!, "base64"));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.rgba]).toEqual([
      ...rgba.subarray((2 * 8 + 2) * 4, (2 * 8 + 4) * 4),
      ...rgba.subarray((3 * 8 + 2) * 4, (3 * 8 + 4) * 4),
    ]);
    const background = parsed.querySelector("svg > rect");
    expect(background?.getAttribute("fill")).toBe("rgb(246, 240, 231)");
    expect(background?.getAttribute("width")).toBe("8");
    expect(background?.getAttribute("height")).toBe("8");
    expect(background?.nextElementSibling?.localName).toBe("g");
  });

  it("rejects malformed crop bounds before encoding instead of clipping them silently", async () => {
    const regions = planHybridRasterRegions({
      bounds: [{ left: 2, top: 2, right: 4, bottom: 4 }],
      width: 8,
      height: 8,
      pixelRatio: 1,
    });
    for (const invalid of [
      { x0: 2, y0: 2, x1: 9, y1: 4 },
      { x0: 2.5, y0: 2, x1: 4, y1: 4 },
      { x0: 4, y0: 2, x1: 4, y1: 4 },
      { x0: -1, y0: 2, x1: 4, y1: 4 },
    ]) {
      await expect(
        assembleNativeHybridSvg({
          vectorSvg:
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
          width: 8,
          height: 8,
          pixelRatio: 1,
          rgba: new Uint8Array(8 * 8 * 4),
          regions: { ...regions, raster: [invalid] },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/invalid pixel bounds/);
    }
  });

  it("rejects an effect region outside the viewport instead of silently dropping it", () => {
    expect(() =>
      planHybridRasterRegions({
        bounds: [{ left: 20, top: 20, right: 30, bottom: 30 }],
        width: 8,
        height: 8,
        pixelRatio: 1,
      }),
    ).toThrow(/outside the export viewport/);
  });
});
