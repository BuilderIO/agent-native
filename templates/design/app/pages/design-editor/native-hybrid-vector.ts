import {
  encodeStraightRgbaPng,
  NativePngEncodingError,
} from "@/pages/design-editor/native-png-encoding";
import { validateEncodedPngViewport } from "@/pages/design-editor/native-raster-encoding";

import { parseCssColorExtended } from "../../../shared/color-utils";
import {
  buildFigmaSvgDocument,
  collectRawFigmaSvgScene,
  hydrateRawFigmaSvgNode,
  type FigmaSvgNode,
} from "../../../shared/figma-svg-scene";

export type HybridRasterBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type HybridPixelRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export class NativeHybridVectorError extends Error {
  constructor(
    readonly code:
      | "region-unavailable"
      | "vector-unsupported"
      | "crop-unavailable"
      | "svg-invalid",
    message: string,
  ) {
    super(message);
    this.name = "NativeHybridVectorError";
  }
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function mergeIntervals(
  intervals: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const ordered = intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of ordered) {
    const last = merged[merged.length - 1];
    if (last && last.end >= interval.start) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function partition(
  regions: HybridPixelRect[],
  width: number,
  height: number,
  outside: boolean,
): HybridPixelRect[] {
  const cuts = uniqueSorted([
    0,
    width,
    ...regions.flatMap((r) => [r.x0, r.x1]),
  ]);
  const result: HybridPixelRect[] = [];
  const active = new Map<string, HybridPixelRect>();
  for (let index = 0; index < cuts.length - 1; index++) {
    const x0 = cuts[index]!;
    const x1 = cuts[index + 1]!;
    if (x0 === x1) continue;
    const covered = mergeIntervals(
      regions
        .filter((region) => region.x0 <= x0 && region.x1 >= x1)
        .map((region) => ({ start: region.y0, end: region.y1 })),
    );
    const intervals: Array<{ start: number; end: number }> = [];
    if (outside) {
      let cursor = 0;
      for (const interval of covered) {
        if (cursor < interval.start)
          intervals.push({ start: cursor, end: interval.start });
        cursor = interval.end;
      }
      if (cursor < height) intervals.push({ start: cursor, end: height });
    } else {
      intervals.push(...covered);
    }
    const next = new Map<string, HybridPixelRect>();
    for (const interval of intervals) {
      if (interval.start >= interval.end) continue;
      const key = `${interval.start}:${interval.end}`;
      const continuing = active.get(key);
      if (continuing?.x1 === x0) {
        continuing.x1 = x1;
        next.set(key, continuing);
      } else {
        const rect = {
          x0,
          x1,
          y0: interval.start,
          y1: interval.end,
        };
        result.push(rect);
        next.set(key, rect);
      }
    }
    active.clear();
    for (const [key, rect] of next) active.set(key, rect);
  }
  return result;
}

export function planHybridRasterRegions(args: {
  bounds: HybridRasterBounds[];
  width: number;
  height: number;
  pixelRatio: number;
}): { raster: HybridPixelRect[]; vector: HybridPixelRect[] } {
  const { width, height, pixelRatio } = args;
  const boundsCount = args.bounds.length;
  const invalidDimensions =
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 8_388_608 ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    pixelRatio > 4;
  const invalidRegions = boundsCount < 1 || boundsCount > 64;
  if (invalidDimensions || invalidRegions)
    throw new NativeHybridVectorError(
      "region-unavailable",
      "The native vector regions exceed the export limits.",
    );
  const regions = args.bounds.map(({ left, top, right, bottom }) => {
    if (
      ![left, top, right, bottom].every(Number.isFinite) ||
      right <= left ||
      bottom <= top
    )
      throw new NativeHybridVectorError(
        "region-unavailable",
        "A native effect has unreadable bounds.",
      );
    const rect = {
      x0: Math.max(0, Math.floor(left * pixelRatio)),
      y0: Math.max(0, Math.floor(top * pixelRatio)),
      x1: Math.min(width, Math.ceil(right * pixelRatio)),
      y1: Math.min(height, Math.ceil(bottom * pixelRatio)),
    };
    if (rect.x0 >= rect.x1 || rect.y0 >= rect.y1)
      throw new NativeHybridVectorError(
        "region-unavailable",
        "A native effect lies outside the export viewport.",
      );
    return rect;
  });
  const raster = partition(regions, width, height, false);
  const vector = partition(regions, width, height, true);
  if (raster.length > 128 || vector.length > 256)
    throw new NativeHybridVectorError(
      "region-unavailable",
      "The native effect overlap is too complex for vector export.",
    );
  return { raster, vector };
}

export function hybridRectCovered(
  rect: HybridPixelRect,
  regions: HybridPixelRect[],
): boolean {
  const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
  if (area <= 0) return false;
  let covered = 0;
  for (const region of regions) {
    const width = Math.max(
      0,
      Math.min(rect.x1, region.x1) - Math.max(rect.x0, region.x0),
    );
    const height = Math.max(
      0,
      Math.min(rect.y1, region.y1) - Math.max(rect.y0, region.y0),
    );
    covered += width * height;
  }
  return covered === area;
}

export function nativeHybridViewportBackground(
  document: Document,
): string | undefined {
  const view = document.defaultView;
  if (!view)
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The selected scene has no readable viewport background.",
    );
  const rootStyle = view.getComputedStyle(document.documentElement);
  const bodyStyle = document.body && view.getComputedStyle(document.body);
  const rootColor = parseCssColorExtended(rootStyle.backgroundColor);
  const bodyColor = bodyStyle
    ? parseCssColorExtended(bodyStyle.backgroundColor)
    : null;
  const propagated = rootColor?.a ? rootColor : bodyColor?.a ? bodyColor : null;
  if (
    propagated &&
    (propagated.a !== 1 ||
      (rootColor?.a ? rootStyle : bodyStyle)?.backgroundImage !== "none")
  )
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The selected viewport background cannot be preserved as a solid vector paint.",
    );
  return propagated
    ? // guard:allow-raw-color — Preserve authored viewport paint in the exported SVG.
      `rgb(${propagated.r}, ${propagated.g}, ${propagated.b})`
    : undefined;
}

function checkedSvg(svg: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    parsed.getElementsByTagName("parsererror").length
  )
    throw new NativeHybridVectorError(
      "svg-invalid",
      "The vector scene could not be serialized as SVG.",
    );
  return root as unknown as SVGSVGElement;
}

function rectElement(
  document: Document,
  rect: HybridPixelRect,
  pixelRatio: number,
): SVGRectElement {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  element.setAttribute("x", String(rect.x0 / pixelRatio));
  element.setAttribute("y", String(rect.y0 / pixelRatio));
  element.setAttribute("width", String((rect.x1 - rect.x0) / pixelRatio));
  element.setAttribute("height", String((rect.y1 - rect.y0) / pixelRatio));
  return element;
}

function base64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    output += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(output);
}

function cropStraightRgba(
  rgba: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  rect: HybridPixelRect,
): { width: number; height: number; rgba: Uint8Array } {
  if (
    ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isSafeInteger) ||
    rect.x0 < 0 ||
    rect.y0 < 0 ||
    rect.x0 >= rect.x1 ||
    rect.y0 >= rect.y1 ||
    rect.x1 > frameWidth ||
    rect.y1 > frameHeight
  )
    throw new NativeHybridVectorError(
      "crop-unavailable",
      "A native effect crop has invalid pixel bounds.",
    );
  const width = rect.x1 - rect.x0;
  const height = rect.y1 - rect.y0;
  const cropped = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((rect.y0 + row) * frameWidth + rect.x0) * 4;
    cropped.set(
      rgba.subarray(sourceOffset, sourceOffset + width * 4),
      row * width * 4,
    );
  }
  return { width, height, rgba: cropped };
}

export async function assembleNativeHybridSvg(args: {
  vectorSvg: string;
  width: number;
  height: number;
  pixelRatio: number;
  rgba: Uint8Array;
  regions: { raster: HybridPixelRect[]; vector: HybridPixelRect[] };
  viewportBackgroundColor?: string;
  signal: AbortSignal;
}): Promise<string> {
  const { width, height, pixelRatio, rgba, regions, signal } = args;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 8_388_608 ||
    rgba.byteLength !== width * height * 4
  )
    throw new NativeHybridVectorError(
      "crop-unavailable",
      "The synchronized native frame has an invalid pixel count.",
    );
  const root = checkedSvg(args.vectorSvg);
  const document = root.ownerDocument;
  const svgNs = "http://www.w3.org/2000/svg";
  const defs =
    Array.from(root.children).find((child) => child.localName === "defs") ??
    document.createElementNS(svgNs, "defs");
  if (!defs.parentNode) root.insertBefore(defs, root.firstChild);
  const clip = document.createElementNS(svgNs, "clipPath");
  const usedIds = new Set(
    [...root.querySelectorAll("[id]")].map((element) => element.id),
  );
  let clipId = "native-vector-unaffected";
  for (let suffix = 1; usedIds.has(clipId); suffix += 1)
    clipId = `native-vector-unaffected-${suffix}`;
  clip.setAttribute("id", clipId);
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  for (const rect of regions.vector)
    clip.append(rectElement(document, rect, pixelRatio));
  defs.append(clip);
  const vectorGroup = document.createElementNS(svgNs, "g");
  vectorGroup.setAttribute("clip-path", `url(#${clipId})`);
  for (const child of [...root.children]) {
    if (child === defs || child.localName === "title") continue;
    vectorGroup.append(child);
  }
  if (args.viewportBackgroundColor) {
    const background = document.createElementNS(svgNs, "rect");
    background.setAttribute("width", String(width / pixelRatio));
    background.setAttribute("height", String(height / pixelRatio));
    background.setAttribute("fill", args.viewportBackgroundColor);
    root.append(background);
  }
  root.append(vectorGroup);

  let encodedBytes = 0;
  for (const rect of regions.raster) {
    if (signal.aborted) throw signal.reason;
    const crop = cropStraightRgba(rgba, width, height, rect);
    let blob: Blob;
    try {
      blob = await encodeStraightRgbaPng(crop, signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof NativePngEncodingError)
        throw new NativeHybridVectorError("crop-unavailable", error.message);
      throw error;
    }
    await validateEncodedPngViewport(blob, {
      width: crop.width,
      height: crop.height,
    });
    encodedBytes += blob.size;
    if (encodedBytes > 32_000_000)
      throw new NativeHybridVectorError(
        "crop-unavailable",
        "The native effect crops exceed the SVG export limit.",
      );
    const data = `data:image/png;base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
    const image = document.createElementNS(svgNs, "image");
    image.setAttribute("x", String(rect.x0 / pixelRatio));
    image.setAttribute("y", String(rect.y0 / pixelRatio));
    image.setAttribute("width", String(crop.width / pixelRatio));
    image.setAttribute("height", String(crop.height / pixelRatio));
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("href", data);
    root.append(image);
  }
  if (signal.aborted) throw signal.reason;
  return new XMLSerializer().serializeToString(root);
}

function removeCoveredRasterNodes(
  node: FigmaSvgNode,
  raster: HybridPixelRect[],
  pixelRatio: number,
): FigmaSvgNode | null {
  if (node.kind === "raster") {
    const bounds = node.rect;
    const physical = {
      x0: Math.floor(bounds.x * pixelRatio),
      y0: Math.floor(bounds.y * pixelRatio),
      x1: Math.ceil((bounds.x + bounds.width) * pixelRatio),
      y1: Math.ceil((bounds.y + bounds.height) * pixelRatio),
    };
    if (!hybridRectCovered(physical, raster))
      throw new NativeHybridVectorError(
        "vector-unsupported",
        "An unsupported source layer lies outside the native effect regions.",
      );
    return null;
  }
  return {
    ...node,
    children: node.children
      ?.map((child) => removeCoveredRasterNodes(child, raster, pixelRatio))
      .filter((child): child is FigmaSvgNode => child !== null),
  };
}

export async function buildNativeHybridSvgFromFrame(args: {
  document: Document;
  viewport: { width: number; height: number };
  pixelRatio: number;
  pixels: {
    width: number;
    height: number;
    rgba: Uint8Array;
    colorSpace: "srgb";
    alpha: "straight";
  };
  runtimeCanvases: readonly HTMLCanvasElement[];
  signal: AbortSignal;
}): Promise<{ svg: string; rasterRegionCount: number }> {
  const { document, viewport, pixelRatio, pixels, runtimeCanvases, signal } =
    args;
  if (
    pixels.colorSpace !== "srgb" ||
    pixels.alpha !== "straight" ||
    pixels.width !== Math.ceil(viewport.width * pixelRatio) ||
    pixels.height !== Math.ceil(viewport.height * pixelRatio) ||
    runtimeCanvases.length < 1
  )
    throw new NativeHybridVectorError(
      "region-unavailable",
      "The synchronized native scene has no valid effect regions.",
    );
  const root = document.documentElement;
  const rootBounds = root.getBoundingClientRect();
  const bounds = runtimeCanvases.map((canvas) => {
    if (canvas.ownerDocument !== document || !canvas.isConnected)
      throw new NativeHybridVectorError(
        "region-unavailable",
        "A native effect canvas is no longer part of the selected scene.",
      );
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left - rootBounds.left,
      top: rect.top - rootBounds.top,
      right: rect.right - rootBounds.left,
      bottom: rect.bottom - rootBounds.top,
    };
  });
  const regions = planHybridRasterRegions({
    bounds,
    width: pixels.width,
    height: pixels.height,
    pixelRatio,
  });
  const raw = collectRawFigmaSvgScene(null, root);
  if (!raw)
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The selected scene has no readable vector layers.",
    );
  const scene = removeCoveredRasterNodes(
    hydrateRawFigmaSvgNode(raw.root),
    regions.raster,
    pixelRatio,
  );
  if (!scene)
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The selected scene cannot be preserved as vector layers.",
    );
  const vector = buildFigmaSvgDocument({
    width: viewport.width,
    height: viewport.height,
    root: scene,
  });
  if (vector.report.omitted.length)
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The selected scene has layers that cannot be represented in the hybrid SVG.",
    );
  const svg = await assembleNativeHybridSvg({
    vectorSvg: vector.svg,
    width: pixels.width,
    height: pixels.height,
    pixelRatio,
    rgba: pixels.rgba,
    regions,
    viewportBackgroundColor: nativeHybridViewportBackground(document),
    signal,
  });
  return { svg, rasterRegionCount: regions.raster.length };
}
