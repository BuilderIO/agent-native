import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";
import { toast } from "sonner";

import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { uniqueLayerId } from "@/pages/design-editor/canvas-primitive-insert";
import { cloneHtmlLayerAtPosition } from "@/pages/design-editor/clone-and-pen-edit";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { escapeHtmlAttributeValue } from "@/pages/design-editor/dom-utils";
import {
  findScreenFrameAtCanvasPoint,
  getAllScreenFrameEntries,
} from "@/pages/design-editor/overview-camera";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PastedImageFilesTarget {
  fileId: string;
  point: { x: number; y: number };
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
  canvasFrameGeometryById: CanvasFrameGeometryById;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  pasteCascadeRef: RefObject<number>;
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
    canvasFrameGeometryById,
    getFreshActiveContent,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    pasteCascadeRef,
    selectInsertedLayers,
    t,
    uploadImageFileForHtml,
    viewModeRef,
    zoom,
  }: PastedImageFilesArgs,
  files: File[],
  target?: PastedImageFilesTarget,
) {
  if (files.length === 0 || !canEditDesign) return false;

  const insertFilesAtPoint = (
    targetFileId: string,
    localPoint: { x: number; y: number } | (() => { x: number; y: number }),
  ) => {
    void (async () => {
      for (const file of files) {
        const imageUrl = await uploadImageFileForHtml(file);
        if (!imageUrl) continue;
        const baseContent =
          targetFileId === activeFile?.id
            ? getFreshActiveContent()
            : (getScreenContent(targetFileId) ?? "");
        const resolvedPoint =
          typeof localPoint === "function" ? localPoint() : localPoint;
        const cascadeOffset = pasteCascadeRef.current * 16;
        pasteCascadeRef.current += 1;
        const nodeId = uniqueLayerId("pasted-image");
        const html = `<img src="${imageUrl}" alt="${escapeHtmlAttributeValue(file.name || "Pasted image")}" data-agent-native-node-id="${nodeId}" data-agent-native-layer-name="Pasted image" style="position:absolute;width:320px;height:auto;" />`;
        const nextContent = cloneHtmlLayerAtPosition(baseContent, html, {
          x: resolvedPoint.x + cascadeOffset,
          y: resolvedPoint.y + cascadeOffset,
        });
        if (!nextContent) {
          toast.error(t("designEditor.toasts.duplicateElementFailed"));
          continue;
        }
        if (targetFileId === activeFile?.id) {
          applyLocalContentUpdate(nextContent, {
            forcePreviewFullDocument: true,
          });
        } else {
          applyFileContentUpdate(targetFileId, nextContent, {
            forcePreviewFullDocument: true,
          });
        }
        selectInsertedLayers(targetFileId, nextContent, [nodeId]);
      }
    })();
  };

  if (target) {
    insertFilesAtPoint(target.fileId, target.point);
    return true;
  }

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
    insertFilesAtPoint(targetFileId, getCenter);
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
    // Best-effort fallback (matches the prior single-image behavior):
    // container-relative pixels as a stand-in canvas point. Overview pan/
    // zoom camera state lives inside MultiScreenCanvas, not here, so this
    // can't account for the live camera transform — see FINAL REPORT.
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    return rect
      ? { x: Math.max(0, rect.width / 2), y: Math.max(0, rect.height / 2) }
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
