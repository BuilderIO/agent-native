import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";
import { toast } from "sonner";

import { getScreenContentPointFromClient } from "@/components/design/design-canvas/coordinate-transforms";
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
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    // coercion-ok: null is "undecodable"; the caller reports it and skips the file
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return null;
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
  return `<img src="${escapeHtmlAttributeValue(src)}" alt="${escapeHtmlAttributeValue(file.name || "Pasted image")}" data-agent-native-node-id="${nodeId}" data-agent-native-layer-name="Pasted image" style="position:absolute;width:${size.width}px;height:${size.height}px;object-fit:cover;" />`;
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

export function replacePastedImageSource(
  content: string,
  nodeId: string,
  source: string | null,
): string {
  const document = new DOMParser().parseFromString(content, "text/html");
  const image = Array.from(
    document.querySelectorAll<HTMLImageElement>("img"),
  ).find((candidate) => candidate.dataset.agentNativeNodeId === nodeId);
  if (!image) return content;
  if (source) image.setAttribute("src", source);
  else image.remove();
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
  uploadImageFileForHtml: (file: File) => Promise<string>;
  viewModeRef: RefObject<"single" | "overview">;
  zoom: number;
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
    uploadImageFileForHtml,
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
        const size = await pastedImageDisplaySize(file);
        if (!size) {
          toast.error(t("common.genericError"));
          continue;
        }
        // Durable content, never the live preview: the preview can predate a
        // reparent or move, and writing it back silently reverts that edit.
        const baseContent =
          targetFileId === activeFile?.id
            ? getFreshActiveContent()
            : (getScreenContent(targetFileId) ?? "");
        const position = topLeftFor(size);
        const nodeId = uniqueLayerId("pasted-image");
        const imageHtml = (src: string) =>
          pastedImageHtml(src, file, size, nodeId);
        const previewUrl =
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : null;
        const previewContent = cloneHtmlLayerAtPosition(
          baseContent,
          imageHtml(previewUrl ?? ""),
          position,
        );
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
                  .querySelectorAll<HTMLImageElement>("img"),
              ).find((image) => image.getAttribute("src") === previewUrl)
                ?.dataset.agentNativeNodeId ?? nodeId);
        if (previewUrl && targetFileId === activeFile?.id) {
          replacePreviewContent(previewContent, null, {
            forceFullDocument: true,
          });
        }
        selectInsertedLayers(targetFileId, previewContent, [insertedNodeId]);

        try {
          const imageUrl = await uploadImageFileForHtml(file);
          const durableContent =
            targetFileId === activeFile?.id
              ? getFreshActiveContent()
              : (getScreenContent(targetFileId) ?? "");
          const durableImageUrl =
            imageUrl && !/^(?:blob|data):/i.test(imageUrl) ? imageUrl : null;
          // The preview node reaches durable content only if an edit during
          // the upload persisted it; otherwise insert it now under the same id.
          const withSource = replacePastedImageSource(
            durableContent,
            insertedNodeId,
            durableImageUrl,
          );
          const activePreviewContent =
            targetFileId === activeFile?.id
              ? (getFreshActivePreviewContent?.() ?? null)
              : null;
          const deletedWhilePending =
            activePreviewContent !== null &&
            !activePreviewContent.includes(`"${insertedNodeId}"`);
          const nextContent =
            withSource === durableContent &&
            durableImageUrl &&
            !deletedWhilePending
              ? (insertClonedHtmlLayers(
                  durableContent,
                  [
                    pastedImageHtml(
                      durableImageUrl,
                      file,
                      size,
                      insertedNodeId,
                    ),
                  ],
                  {
                    positions: [{ ...position, space: "visual" }],
                    preserveIncomingNodeIds: true,
                  },
                )?.content ?? durableContent)
              : withSource;
          if (nextContent !== durableContent) {
            applyDurableContent(nextContent);
          } else if (targetFileId === activeFile?.id) {
            replacePreviewContent(durableContent, null, {
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
      : { x: 120, y: 120 };
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
function canvasPointFromClient(
  { clientX, clientY }: PastedImageFilesClientAnchor,
  frames: ReturnType<typeof getAllScreenFrameEntries>,
): { x: number; y: number } | null {
  for (const frame of frames) {
    if (frame.geometry.rotation) continue;
    const iframe = document.querySelector<HTMLIFrameElement>(
      `[data-frame-id="${CSS.escape(frame.id)}"] iframe`,
    );
    if (!iframe?.offsetWidth) continue;
    const rect = iframe.getBoundingClientRect();
    const scale = rect.width / iframe.offsetWidth;
    return {
      x: frame.geometry.x + (clientX - rect.left) / scale,
      y: frame.geometry.y + (clientY - rect.top) / scale,
    };
  }
  return null;
}
