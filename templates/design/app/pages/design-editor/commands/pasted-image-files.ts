import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { screenToCanvasPoint } from "@shared/canvas-math";
import type { RefObject } from "react";
import { toast } from "sonner";

import { getScreenContentPointFromClient } from "@/components/design/design-canvas/coordinate-transforms";
import { SURFACE_PADDING } from "@/components/design/multi-screen/overview-layout";
import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  buildPastedSvgLayer,
  extractSvgMarkup,
  isSvgFile,
  svgLayerName,
} from "@/lib/svg-paste";
import { uniqueLayerId } from "@/pages/design-editor/canvas-primitive-insert";
import {
  cloneHtmlLayerAtPosition,
  insertClonedHtmlLayers,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { escapeHtmlAttributeValue } from "@/pages/design-editor/dom-utils";
import {
  findScreenFrameAtCanvasPoint,
  getAllScreenFrameEntries,
} from "@/pages/design-editor/overview-camera";
import type { DesignFile } from "@/pages/design-editor/types";

/** A pointer position (Paste here) the pasted layer centres on. */
export interface PastedImageFilesClientAnchor {
  clientX: number;
  clientY: number;
}

export interface PastedImageFilesTarget {
  fileId: string;
  /** Where the pasted layer's centre lands, in the target file's space. */
  point: { x: number; y: number };
}

/**
 * CSS pixels per image pixel from a PNG's pHYs chunk: a 144-dpi export of a
 * 132px frame is 264px wide and pastes at 132, as in Figma.
 */
export function pngDensityScale(bytes: Uint8Array): number {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, index) => bytes[index] !== byte)) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT" || type === "IEND") return 1;
    if (type === "pHYs" && offset + 17 <= bytes.length) {
      const pixelsPerMeter = view.getUint32(offset + 8);
      const metreUnit = bytes[offset + 16] === 1;
      const scale = Math.round(((pixelsPerMeter * 0.0254) / 72) * 100) / 100;
      return metreUnit && scale > 1 ? scale : 1;
    }
    offset += 12 + length;
  }
  return 1;
}

async function pastedImageDisplaySize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  let width: number;
  let height: number;
  let previewUrl: string | null = null;
  try {
    previewUrl =
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
    ({ width, height } = await readPastedImageDimensions(file, previewUrl));
  } catch {
    // coercion-ok: the caller turns decode failure into its typed "undecodable" result.
    return null;
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }
  const scale =
    file.type === "image/png"
      ? pngDensityScale(
          new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()),
        )
      : 1;
  return {
    width: Math.round((width / scale) * 100) / 100,
    height: Math.round((height / scale) * 100) / 100,
  };
}

function pastedImageHtml(
  src: string,
  file: File,
  size: { width: number; height: number },
  nodeId: string,
): string {
  // object-fit:cover is Figma's default Fill mode for a placed image.
  const name = file.name || "Pasted image";
  return `<img src="${escapeHtmlAttributeValue(src)}" alt="${escapeHtmlAttributeValue(name)}" data-agent-native-node-id="${nodeId}" data-agent-native-layer-name="${escapeHtmlAttributeValue(name)}" style="position:absolute;width:${size.width}px;height:${size.height}px;object-fit:cover;" />`;
}

export type PastedFileLayer =
  | { ok: true; html: string }
  | { ok: false; reason: "undecodable" | "upload-failed" };

/**
 * The layer a clipboard file becomes, with rasters already uploaded, for
 * commands that need finished markup up front (Paste to replace).
 */
export async function pastedFileLayerHtml(
  file: File,
  uploadImageFileForHtml: (file: File) => Promise<string>,
  onUploadStart: () => void,
): Promise<PastedFileLayer> {
  if (isSvgFile(file)) {
    const markup = extractSvgMarkup(await file.text());
    const layer = markup
      ? buildPastedSvgLayer(markup, svgLayerName(file.name))
      : null;
    if (layer) return { ok: true, html: layer.html };
  }
  const size = await pastedImageDisplaySize(file);
  if (!size) return { ok: false, reason: "undecodable" };
  onUploadStart();
  let url: string;
  try {
    url = await uploadImageFileForHtml(file);
    // coercion-ok: a thrown upload becomes the typed "upload-failed" result
  } catch {
    return { ok: false, reason: "upload-failed" };
  }
  if (!url || /^(?:blob|data):/i.test(url)) {
    return { ok: false, reason: "upload-failed" };
  }
  return {
    ok: true,
    html: pastedImageHtml(url, file, size, uniqueLayerId("pasted-image")),
  };
}

type PastedImageDimensions = { width: number; height: number };

function validDimensions(
  width: number,
  height: number,
): PastedImageDimensions | null {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

async function readPastedImageDimensions(
  file: File,
  previewUrl: string | null,
): Promise<PastedImageDimensions> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = validDimensions(bitmap.width, bitmap.height);
      bitmap.close();
      if (dimensions) return dimensions;
    } catch (error) {
      if (!previewUrl || typeof Image === "undefined") throw error;
      // Fall back to the browser image decoder below.
    }
  }

  if (previewUrl && typeof Image !== "undefined") {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const dimensions = validDimensions(
          image.naturalWidth,
          image.naturalHeight,
        );
        if (dimensions) resolve(dimensions);
        else reject(new Error("Pasted image has invalid dimensions"));
      };
      image.onerror = () => reject(new Error("Pasted image could not decode"));
      image.src = previewUrl;
    });
  }

  throw new Error("Could not decode pasted image dimensions");
}

async function readPastedVideoDimensions(
  previewUrl: string | null,
): Promise<PastedImageDimensions> {
  if (!previewUrl || typeof document === "undefined") {
    throw new Error("Could not decode pasted video dimensions");
  }
  return await new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => {
      finish(new Error("Pasted video metadata timed out"));
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
    };
    const finish = (error?: Error) => {
      const dimensions = error
        ? null
        : validDimensions(video.videoWidth, video.videoHeight);
      cleanup();
      if (error) reject(error);
      else if (dimensions) resolve(dimensions);
      else reject(new Error("Pasted video has invalid dimensions"));
    };
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => finish(), { once: true });
    video.addEventListener(
      "error",
      () => finish(new Error("Pasted video could not decode")),
      { once: true },
    );
    video.src = previewUrl;
    video.load();
  });
}

function pastedImageStyle({ width, height }: PastedImageDimensions): string {
  return `position:absolute;width:${width}px;height:${height}px;`;
}

export function replacePastedMediaSource(
  content: string,
  nodeId: string,
  source: string | null,
): string {
  const document = new DOMParser().parseFromString(content, "text/html");
  const media = Array.from(
    document.querySelectorAll<HTMLImageElement | HTMLVideoElement>(
      "img, video",
    ),
  ).find((candidate) => candidate.dataset.agentNativeNodeId === nodeId);
  if (!media) return content;
  if (source) media.setAttribute("src", source);
  else media.remove();
  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}

export interface PastedImageFilesArgs {
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  /** The canvas-space rect visible between the editor chrome. */
  getVisibleCanvasRect: () => VisibleCanvasRect | null;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  getFreshActiveContent: () => string;
  getFreshActivePreviewContent?: () => string | null;
  getScreenContent: (screenId: string) => string;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  pasteCascadeRef: RefObject<number>;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => unknown;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  uploadMediaFileForHtml: (file: File) => Promise<string>;
  viewModeRef: RefObject<"single" | "overview">;
  zoom: number;
}

export function getOverviewCanvasCenter(container: HTMLDivElement | null): {
  x: number;
  y: number;
} {
  const fallback = { x: 120, y: 120 };
  const rect = container?.getBoundingClientRect();
  const world = container?.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  if (!rect || !world || typeof DOMMatrixReadOnly === "undefined") {
    return fallback;
  }

  const transform = getComputedStyle(world).transform;
  const matrix = new DOMMatrixReadOnly(
    transform === "none" ? undefined : transform,
  );
  const zoom = matrix.a * 100;
  if (
    !Number.isFinite(matrix.e) ||
    !Number.isFinite(matrix.f) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return fallback;
  }

  return screenToCanvasPoint(
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { x: matrix.e, y: matrix.f, zoom },
    { x: rect.left, y: rect.top },
    SURFACE_PADDING,
  );
}

export function runPastedImageFiles(
  {
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    boardFileId,
    canEditDesign,
    canvasContainerRef,
    getVisibleCanvasRect,
    canvasFrameGeometryById,
    getFreshActiveContent,
    getFreshActivePreviewContent,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    pasteCascadeRef,
    replacePreviewContent,
    selectInsertedLayers,
    t,
    uploadMediaFileForHtml,
    viewModeRef,
    zoom,
  }: PastedImageFilesArgs,
  files: File[],
  target?: PastedImageFilesTarget | PastedImageFilesClientAnchor,
) {
  if (files.length === 0 || !canEditDesign) return false;

  const insertFilesAtPoint = (
    targetFileId: string,
    localPoint: { x: number; y: number } | (() => { x: number; y: number }),
  ) => {
    const applyDurableContent = (nextContent: string) => {
      if (targetFileId === activeFile?.id) {
        applyLocalContentUpdate(nextContent, {
          forcePreviewFullDocument: true,
        });
      } else {
        applyFileContentUpdate(targetFileId, nextContent, {
          forcePreviewFullDocument: true,
        });
      }
    };

    const topLeftFor = (size: { width: number; height: number }) => {
      const centre =
        typeof localPoint === "function" ? localPoint() : localPoint;
      // An explicit target (drop, Paste here) lands exactly where it points.
      const cascadeOffset = target ? 0 : pasteCascadeRef.current * 16;
      if (!target) pasteCascadeRef.current += 1;
      return {
        x: Math.round(centre.x - size.width / 2 + cascadeOffset),
        y: Math.round(centre.y - size.height / 2 + cascadeOffset),
      };
    };

    const insertSvgFile = async (file: File) => {
      const markup = extractSvgMarkup(await file.text());
      const layer = markup
        ? buildPastedSvgLayer(markup, svgLayerName(file.name))
        : null;
      if (!layer) return false;
      const baseContent =
        targetFileId === activeFile?.id
          ? getFreshActiveContent()
          : (getScreenContent(targetFileId) ?? "");
      const inserted = insertClonedHtmlLayers(baseContent, [layer.html], {
        positions: [{ ...topLeftFor(layer), space: "visual" }],
      });
      if (!inserted) {
        toast.error(t("designEditor.toasts.duplicateElementFailed"));
        return true;
      }
      applyDurableContent(inserted.content);
      selectInsertedLayers(
        targetFileId,
        inserted.content,
        inserted.rootNodeIds,
      );
      return true;
    };

    void (async () => {
      for (const file of files) {
        if (isSvgFile(file) && (await insertSvgFile(file))) continue;
        const isVideo = file.type.toLowerCase().startsWith("video/");
        if (!isVideo && !file.type.toLowerCase().startsWith("image/")) {
          toast.error(t("common.genericError"));
          continue;
        }
        // Durable content, never the live preview: the preview can predate a
        // reparent or move, and writing it back silently reverts that edit.
        const baseContent =
          targetFileId === activeFile?.id
            ? getFreshActiveContent()
            : (getScreenContent(targetFileId) ?? "");
        const nodeId = uniqueLayerId("pasted-image");
        const previewUrl =
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : null;
        let dimensions: PastedImageDimensions;
        try {
          dimensions = isVideo
            ? await readPastedVideoDimensions(previewUrl)
            : await readPastedImageDimensions(file, previewUrl);
        } catch {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          toast.error(t("common.genericError"));
          continue;
        }
        const position = topLeftFor(dimensions);
        const mediaStyle = pastedImageStyle(dimensions);
        const mediaName = escapeHtmlAttributeValue(file.name);
        const positionedStyle = `${mediaStyle}left:${position.x}px;top:${position.y}px;`;
        const html = isVideo
          ? `<video src="${escapeHtmlAttributeValue(previewUrl ?? "")}" controls playsinline preload="metadata" data-agent-native-node-id="${nodeId}" data-agent-native-layer-name="${mediaName}" style="${positionedStyle}"></video>`
          : pastedImageHtml(previewUrl ?? "", file, dimensions, nodeId).replace(
              mediaStyle,
              positionedStyle,
            );
        const previewContent = cloneHtmlLayerAtPosition(baseContent, html, {
          x: position.x,
          y: position.y,
        });
        if (!previewContent) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          toast.error(t("designEditor.toasts.duplicateElementFailed"));
          continue;
        }

        const insertedNodeId =
          previewUrl === null
            ? nodeId
            : (Array.from(
                new DOMParser()
                  .parseFromString(previewContent, "text/html")
                  .querySelectorAll<HTMLImageElement | HTMLVideoElement>(
                    "img, video",
                  ),
              ).find((media) => media.getAttribute("src") === previewUrl)
                ?.dataset.agentNativeNodeId ?? nodeId);
        if (previewUrl && targetFileId === activeFile?.id) {
          replacePreviewContent(previewContent, null, {
            forceFullDocument: true,
          });
        }
        selectInsertedLayers(targetFileId, previewContent, [insertedNodeId]);

        try {
          const imageUrl = await uploadMediaFileForHtml(file);
          const durableContent =
            targetFileId === activeFile?.id
              ? getFreshActiveContent()
              : (getScreenContent(targetFileId) ?? "");
          const durableMediaUrl =
            imageUrl && !/^(?:blob|data):/i.test(imageUrl) ? imageUrl : null;
          // The preview node reaches durable content only if an edit during
          // the upload persisted it; otherwise insert it now under the same id.
          const activePreviewContent =
            targetFileId === activeFile?.id
              ? (getFreshActivePreviewContent?.() ?? null)
              : null;
          const deletedWhilePending =
            activePreviewContent !== null &&
            !activePreviewContent.includes(`"${insertedNodeId}"`);
          const currentContent = activePreviewContent ?? durableContent;
          const replacedContent = replacePastedMediaSource(
            currentContent,
            insertedNodeId,
            durableMediaUrl,
          );
          const nextContent =
            replacedContent !== currentContent ||
            !durableMediaUrl ||
            deletedWhilePending
              ? replacedContent
              : (insertClonedHtmlLayers(
                  durableContent,
                  [
                    isVideo
                      ? `<video src="${escapeHtmlAttributeValue(durableMediaUrl)}" controls playsinline preload="metadata" data-agent-native-node-id="${insertedNodeId}" data-agent-native-layer-name="${mediaName}" style="${mediaStyle}"></video>`
                      : pastedImageHtml(
                          durableMediaUrl,
                          file,
                          dimensions,
                          insertedNodeId,
                        ),
                  ],
                  {
                    positions: [{ ...position, space: "visual" }],
                    preserveIncomingNodeIds: true,
                  },
                )?.content ?? durableContent);
          if (nextContent !== durableContent) applyDurableContent(nextContent);
          if (!durableMediaUrl && targetFileId === activeFile?.id) {
            replacePreviewContent(currentContent, null, {
              forceFullDocument: true,
            });
          }
        } catch {
          const currentContent =
            targetFileId === activeFile?.id
              ? getFreshActiveContent()
              : (getScreenContent(targetFileId) ?? "");
          if (targetFileId === activeFile?.id) {
            replacePreviewContent(currentContent, null, {
              forceFullDocument: true,
            });
          }
          toast.error(t("common.genericError"));
        } finally {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        }
      }
    })();
  };

  if (target && "fileId" in target) {
    insertFilesAtPoint(target.fileId, target.point);
    return true;
  }
  const clientAnchor = target;

  if (viewModeRef.current !== "overview") {
    const targetFileId = activeFile?.id;
    if (!targetFileId) return false;
    const getCenter = () => {
      const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
        "[data-design-preview-iframe]",
      );
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        const factor = zoom / 100;
        return {
          x: Math.max(0, iframeRect.width / 2 / factor),
          y: Math.max(0, iframeRect.height / 2 / factor),
        };
      }
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      return rect
        ? {
            x: Math.max(0, rect.width / 2),
            y: Math.max(0, rect.height / 2),
          }
        : { x: 120, y: 120 };
    };
    const iframe = canvasContainerRef.current?.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    insertFilesAtPoint(
      targetFileId,
      clientAnchor && iframe
        ? getScreenContentPointFromClient(
            clientAnchor.clientX,
            clientAnchor.clientY,
            iframe.getBoundingClientRect(),
            { width: iframe.offsetWidth, height: iframe.offsetHeight },
            {
              left: iframe.contentWindow?.scrollX ?? 0,
              top: iframe.contentWindow?.scrollY ?? 0,
            },
          )
        : getCenter,
    );
    return true;
  }

  // Overview mode: resolve a canvas-space anchor point, then hit-test it
  // against real screen frames.
  if (!boardFileId) return false;
  const frames = getAllScreenFrameEntries({
    overviewScreens,
    canvasFrameGeometryById,
  });
  const anchorCanvasPoint = (() => {
    const clientCanvasPoint = clientAnchor
      ? canvasPointFromClient(clientAnchor, frames)
      : null;
    if (clientCanvasPoint) return clientCanvasPoint;
    if (overviewSelectedScreenIds.length === 1) {
      const screenId = overviewSelectedScreenIds[0]!;
      const frame = frames.find((entry) => entry.id === screenId);
      if (frame) {
        return {
          x: frame.geometry.x + frame.geometry.width / 2,
          y: frame.geometry.y + frame.geometry.height / 2,
        };
      }
    }
    const visible = getVisibleCanvasRect();
    return visible
      ? {
          x: visible.x + visible.width / 2,
          y: visible.y + visible.height / 2,
        }
      : getOverviewCanvasCenter(canvasContainerRef.current);
  })();
  const hitFrame = findScreenFrameAtCanvasPoint(
    anchorCanvasPoint,
    frames,
    boardFileId,
  );
  const targetFileId = hitFrame?.id ?? boardFileId;
  const localAnchor = hitFrame
    ? {
        x: anchorCanvasPoint.x - hitFrame.geometry.x,
        y: anchorCanvasPoint.y - hitFrame.geometry.y,
      }
    : anchorCanvasPoint;

  insertFilesAtPoint(targetFileId, localAnchor);
  return true;
}

/**
 * The overview camera lives inside MultiScreenCanvas; an unrotated screen's
 * rendered iframe against its canvas geometry gives the same mapping.
 */
export function canvasPointFromClient(
  { clientX, clientY }: PastedImageFilesClientAnchor,
  frames: ReturnType<typeof getAllScreenFrameEntries>,
): { x: number; y: number } | null {
  const surface = document.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-surface]",
  );
  const world = surface?.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  if (surface && world) {
    const transform = getComputedStyle(world).transform;
    const matrixValues =
      transform === "none"
        ? [1, 0, 0, 1, 0, 0]
        : /^matrix\(([^)]+)\)$/.exec(transform)?.[1]?.split(",").map(Number);
    if (matrixValues?.length === 6 && matrixValues.every(Number.isFinite)) {
      const [scaleX, skewY, skewX, scaleY, panX, panY] = matrixValues;
      if (scaleX !== 0 && scaleX === scaleY && skewY === 0 && skewX === 0) {
        const rect = surface.getBoundingClientRect();
        const point = screenToCanvasPoint(
          { x: clientX, y: clientY },
          { x: panX!, y: panY!, zoom: scaleX! * 100 },
          { x: rect.left, y: rect.top },
          SURFACE_PADDING,
        );
        return point;
      }
    }
  }

  // Keep the iframe fallback scoped to the frame under the pointer. The
  // first iframe is not a canvas transform when Paste here targets another
  // screen or empty board space.
  for (const frame of frames) {
    if (frame.geometry.rotation) continue;
    const iframe = document.querySelector<HTMLIFrameElement>(
      `[data-frame-id="${CSS.escape(frame.id)}"] iframe`,
    );
    if (!iframe?.offsetWidth) continue;
    const rect = iframe.getBoundingClientRect();
    const pointIsWithinFrame =
      rect.left <= clientX &&
      clientX <= rect.right &&
      rect.top <= clientY &&
      clientY <= rect.bottom;
    if (!pointIsWithinFrame) continue;
    const scale = rect.width / iframe.offsetWidth;
    return {
      x: frame.geometry.x + (clientX - rect.left) / scale,
      y: frame.geometry.y + (clientY - rect.top) / scale,
    };
  }
  return null;
}
