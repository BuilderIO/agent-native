import type { CanvasFrameGeometryById } from "@shared/canvas-frames";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getExportCompositeBounds,
  resolveRasterExportScale,
} from "@/pages/design-editor/export-capture";
import { prepareExportCaptureTarget } from "@/pages/design-editor/export-snapshot-frame";
import type { ExportCaptureTarget } from "@/pages/design-editor/export-snapshot-frame";
import {
  rasterMimeType,
  validateEncodedRasterBlob,
  type NativeRasterFormat,
} from "@/pages/design-editor/native-raster-encoding";
import {
  NativeSceneExportError,
  renderSelectedNativeSceneBlob,
} from "@/pages/design-editor/native-scene-export-client";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import {
  PngCaptureError,
  renderExportDocumentCanvas,
  resolveBoardExportCropRect,
  resolveExportCropTarget,
  resolveSelectedExportElements,
} from "@/pages/design-editor/png-export-render";

import { resolveNativeExportCrop } from "./native-export-crop";
import { pinNativeViewedSource } from "./native-viewed-source-version";

export interface RenderPngBlobArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  boardFileId?: string;
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  designId?: string;
  overviewScreens: OverviewScreen[];
  releaseScreenFromExport?: () => void;
  resolvePngCaptureTarget: (
    scope: PngCaptureScope,
    screenId?: string,
  ) =>
    | (ExportCaptureTarget & {
        cropSelection: ElementInfo | readonly ElementInfo[] | null;
        sourceFileId?: string;
      })
    | Promise<
        ExportCaptureTarget & {
          cropSelection: ElementInfo | readonly ElementInfo[] | null;
          sourceFileId?: string;
        }
      >;
  selectedScreenIds: string[];
  viewMode: "single" | "overview";
}

function hasNativeEffects(doc: Document | null): doc is Document {
  return Boolean(
    doc?.querySelector('script[type="application/x-agent-native-effects"]'),
  );
}

export function resolvePngSourceFileId(args: {
  requestedScreenId?: string;
  iframe: HTMLIFrameElement;
  boardFileId?: string;
  activeFileId?: string;
}): string | undefined {
  return (
    args.requestedScreenId ??
    args.iframe.getAttribute("data-screen-iframe-id") ??
    (args.iframe.closest("[data-board-surface-layer]")
      ? args.boardFileId
      : args.activeFileId)
  );
}

async function renderNativeCapture(args: {
  designId?: string;
  sourceFileId?: string;
  iframe: HTMLIFrameElement;
  doc: Document;
  scale: number;
  format: NativeRasterFormat;
  signal?: AbortSignal;
  crop?: ReturnType<typeof resolveNativeExportCrop>;
}): Promise<Blob> {
  if (!args.designId || !args.sourceFileId)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native scene has no authoritative Design file identity.",
    );
  const sourcePin = pinNativeViewedSource(args);
  const sourceViewport = {
    width: args.iframe.clientWidth,
    height: args.iframe.clientHeight,
  };
  if (
    args.crop &&
    (args.crop.x < 0 ||
      args.crop.y < 0 ||
      args.crop.x + args.crop.width > sourceViewport.width ||
      args.crop.y + args.crop.height > sourceViewport.height)
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native frame lies outside the mounted Design viewport.",
    );
  const assertStillViewed = () => {
    sourcePin.assertStillViewed();
    if (
      args.iframe.clientWidth !== sourceViewport.width ||
      args.iframe.clientHeight !== sourceViewport.height
    )
      throw new NativeSceneExportError(
        "source-stale",
        "The mounted Design viewport changed during native export capture.",
      );
  };
  return renderSelectedNativeSceneBlob({
    designId: args.designId,
    fileId: args.sourceFileId,
    expectedVersionHash: sourcePin.expectedVersionHash,
    assertStillViewed,
    ...(args.crop && { sourceViewport }),
    viewport: {
      width: args.crop?.width ?? args.iframe.clientWidth,
      height: args.crop?.height ?? args.iframe.clientHeight,
    },
    ...(args.crop && { crop: args.crop }),
    pixelRatio: args.scale,
    format: args.format,
    signal: args.signal,
  });
}

export interface SelectedScreenExportFrame {
  screenId: string;
  order: number;
  z: number;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
}

export function resolveSelectedScreenExportFrames(args: {
  selectedScreenIds: string[];
  overviewScreens: OverviewScreen[];
  canvasFrameGeometryById: CanvasFrameGeometryById;
  iframeSizeById?: ReadonlyMap<string, { width: number; height: number }>;
}): SelectedScreenExportFrame[] {
  return args.selectedScreenIds.map((screenId, order) => {
    const screen = args.overviewScreens.find(
      (candidate) => candidate.id === screenId,
    );
    const geometry = args.canvasFrameGeometryById[screenId] ?? {};
    const iframeSize = args.iframeSizeById?.get(screenId);
    return {
      screenId,
      order,
      z: geometry.z ?? order,
      frame: {
        x: geometry.x ?? order * ((screen?.width ?? 1440) + 80),
        y: geometry.y ?? 0,
        width: Math.max(
          1,
          geometry.width ?? screen?.width ?? iframeSize?.width ?? 0,
        ),
        height: Math.max(
          1,
          geometry.height ?? screen?.height ?? iframeSize?.height ?? 0,
        ),
        rotation: geometry.rotation ?? 0,
      },
    };
  });
}

export function resolveSelectedScreensExportBounds(args: {
  selectedScreenIds: string[];
  overviewScreens: OverviewScreen[];
  canvasFrameGeometryById: CanvasFrameGeometryById;
  iframeSizeById?: ReadonlyMap<string, { width: number; height: number }>;
}) {
  if (args.selectedScreenIds.length === 0) return null;
  const frames = resolveSelectedScreenExportFrames(args);
  return getExportCompositeBounds(frames.map(({ frame }) => frame));
}

export async function runRenderPngBlob(
  {
    activeCanvasSourceType,
    boardFileId,
    canvasFrameGeometryById,
    designId,
    overviewScreens,
    releaseScreenFromExport,
    resolvePngCaptureTarget,
    selectedScreenIds,
    viewMode,
  }: RenderPngBlobArgs,
  {
    scope,
    settings,
    format = "png",
    signal,
  }: {
    scope: PngCaptureScope;
    settings?: Partial<ExportSettingsValue>;
    format?: NativeRasterFormat;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  const requestedExportScale =
    settings?.scale ?? Math.max(2, window.devicePixelRatio || 1);
  let outputCanvas: HTMLCanvasElement;

  if (
    scope === "screens" &&
    viewMode === "overview" &&
    selectedScreenIds.length > 0
  ) {
    const preparedTargets: Array<{ dispose: () => void }> = [];
    try {
      const captureSources: Array<
        Awaited<ReturnType<typeof prepareExportCaptureTarget>> & {
          screenId: string;
        }
      > = [];
      for (const screenId of selectedScreenIds) {
        try {
          const target = await resolvePngCaptureTarget(scope, screenId);
          if (hasNativeEffects(target.doc)) {
            if (selectedScreenIds.length !== 1)
              throw new NativeSceneExportError(
                "scene-unreadable",
                "Native effects in multiple selected screens need a composed export target.",
              );
            const selectedFrame = resolveSelectedScreenExportFrames({
              selectedScreenIds: [screenId],
              overviewScreens,
              canvasFrameGeometryById,
              iframeSizeById: new Map([
                [
                  screenId,
                  {
                    width: target.iframe.clientWidth,
                    height: target.iframe.clientHeight,
                  },
                ],
              ]),
            })[0]?.frame;
            if (
              !selectedFrame ||
              Math.abs(selectedFrame.rotation) > 0.0001 ||
              Math.abs(selectedFrame.width - target.iframe.clientWidth) > 0.5 ||
              Math.abs(selectedFrame.height - target.iframe.clientHeight) > 0.5
            )
              throw new NativeSceneExportError(
                "scene-unreadable",
                "Native screen export needs a composed geometry target for scaled or rotated frames.",
              );
            return await renderNativeCapture({
              designId,
              sourceFileId: target.sourceFileId,
              iframe: target.iframe,
              doc: target.doc,
              scale: requestedExportScale,
              format,
              signal,
            });
          }
          const prepared = await prepareExportCaptureTarget(target);
          preparedTargets.push(prepared);
          captureSources.push({ screenId, ...prepared });
        } finally {
          releaseScreenFromExport?.();
        }
      }
      const exportFrames = resolveSelectedScreenExportFrames({
        selectedScreenIds,
        overviewScreens,
        canvasFrameGeometryById,
        iframeSizeById: new Map(
          captureSources.map(({ screenId, iframe }) => [
            screenId,
            { width: iframe.clientWidth, height: iframe.clientHeight },
          ]),
        ),
      });
      const captures = exportFrames
        .map(({ order, ...frameInfo }) => ({
          ...captureSources[order]!,
          ...frameInfo,
          order,
        }))
        .sort((left, right) => left.z - right.z || left.order - right.order);
      const bounds = getExportCompositeBounds(
        captures.map((capture) => capture.frame),
      );
      if (!bounds) throw new PngCaptureError("no-preview");
      const exportScale = resolveRasterExportScale({
        width: bounds.width,
        height: bounds.height,
        requestedScale: requestedExportScale,
      });
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = Math.max(1, Math.ceil(bounds.width * exportScale));
      outputCanvas.height = Math.max(1, Math.ceil(bounds.height * exportScale));
      const context = outputCanvas.getContext("2d");
      if (!context) throw new PngCaptureError("blob-failed");

      for (const capture of captures) {
        const view = capture.doc.defaultView;
        const viewportCropRect = {
          x: view?.scrollX ?? 0,
          y: view?.scrollY ?? 0,
          width: Math.max(1, capture.iframe.clientWidth),
          height: Math.max(1, capture.iframe.clientHeight),
        };
        const rendered = await renderExportDocumentCanvas({
          doc: capture.doc,
          iframe: capture.iframe,
          exportScale,
          cropRect: viewportCropRect,
        });
        const frame = capture.frame;
        context.save();
        context.translate(
          (frame.x + frame.width / 2 - bounds.x) * exportScale,
          (frame.y + frame.height / 2 - bounds.y) * exportScale,
        );
        context.rotate(((frame.rotation ?? 0) * Math.PI) / 180);
        context.drawImage(
          rendered.canvas,
          (-frame.width / 2) * exportScale,
          (-frame.height / 2) * exportScale,
          frame.width * exportScale,
          frame.height * exportScale,
        );
        context.restore();
      }
    } finally {
      for (const target of preparedTargets) target.dispose();
    }
  } else {
    let prepared: Awaited<
      ReturnType<typeof prepareExportCaptureTarget>
    > | null = null;
    try {
      const target = await resolvePngCaptureTarget(scope);
      if (hasNativeEffects(target.doc)) {
        const crop =
          scope === "element"
            ? resolveNativeExportCrop(target.doc, target.cropSelection)
            : null;
        if (
          scope === "document" &&
          boardFileId &&
          target.sourceFileId === boardFileId
        ) {
          const crop = resolveBoardExportCropRect(target.doc, target.iframe);
          if (
            crop &&
            (Math.abs(crop.x) > 0.5 ||
              Math.abs(crop.y) > 0.5 ||
              Math.abs(crop.width - target.iframe.clientWidth) > 0.5 ||
              Math.abs(crop.height - target.iframe.clientHeight) > 0.5)
          )
            throw new NativeSceneExportError(
              "scene-unreadable",
              "The selected board needs an explicit native crop target for its authored artwork.",
            );
        }
        return await renderNativeCapture({
          designId,
          sourceFileId: target.sourceFileId,
          iframe: target.iframe,
          doc: target.doc,
          scale: requestedExportScale,
          format,
          signal,
          crop,
        });
      }
      prepared = await prepareExportCaptureTarget(target);
      const { cropSelection, doc, iframe } = {
        ...target,
        doc: prepared.doc,
        iframe: prepared.iframe,
      };
      const selections = Array.isArray(cropSelection)
        ? cropSelection
        : cropSelection
          ? [cropSelection]
          : [];
      if (scope === "element" && selections.length === 0) {
        throw new PngCaptureError("selection-unresolved");
      }
      const cropTarget = resolveExportCropTarget(doc, cropSelection);
      if (cropTarget.kind === "unresolved") {
        throw new PngCaptureError("selection-unresolved");
      }
      const selectionCropRect =
        cropTarget.kind === "rect" ? cropTarget.rect : null;
      const boardCropRect =
        scope === "document" &&
        activeCanvasSourceType === "inline" &&
        !selectionCropRect
          ? resolveBoardExportCropRect(doc, iframe)
          : null;
      const rendered = await renderExportDocumentCanvas({
        doc,
        iframe,
        exportScale: requestedExportScale,
        cropRect: selectionCropRect ?? boardCropRect,
        isolateSelectedElements: selectionCropRect
          ? resolveSelectedExportElements(doc, cropSelection)
          : [],
      });
      outputCanvas = rendered.canvas;
    } finally {
      prepared?.dispose();
      releaseScreenFromExport?.();
    }
  }
  if (format === "jpg") {
    const matteCanvas = document.createElement("canvas");
    matteCanvas.width = outputCanvas.width;
    matteCanvas.height = outputCanvas.height;
    const matteContext = matteCanvas.getContext("2d");
    if (!matteContext) throw new PngCaptureError("blob-failed");
    // guard:allow-raw-color — JPEG has no alpha; the export matte is fixed white, independent of editor theme.
    matteContext.fillStyle = "#ffffff";
    matteContext.fillRect(0, 0, matteCanvas.width, matteCanvas.height);
    matteContext.drawImage(outputCanvas, 0, 0);
    outputCanvas = matteCanvas;
  }
  const mimeType = rasterMimeType(format);
  const encoded = await new Promise<Blob | null>((resolve) => {
    outputCanvas.toBlob(
      resolve,
      mimeType,
      mimeType === "image/png" ? undefined : 0.95,
    );
  });
  try {
    return await validateEncodedRasterBlob(encoded, format);
  } catch {
    throw new PngCaptureError("blob-failed");
  }
}
