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
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import {
  PngCaptureError,
  renderExportDocumentCanvas,
  resolveBoardExportCropRect,
  resolveExportCropTarget,
  resolveSelectedExportElements,
} from "@/pages/design-editor/png-export-render";

export interface RenderPngBlobArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  overviewScreens: OverviewScreen[];
  releaseScreenFromExport?: () => void;
  resolvePngCaptureTarget: (
    scope: PngCaptureScope,
    screenId?: string,
  ) =>
    | (ExportCaptureTarget & {
        cropSelection: ElementInfo | readonly ElementInfo[] | null;
      })
    | Promise<
        ExportCaptureTarget & {
          cropSelection: ElementInfo | readonly ElementInfo[] | null;
        }
      >;
  selectedScreenIds: string[];
  viewMode: "single" | "overview";
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
    canvasFrameGeometryById,
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
  }: {
    scope: PngCaptureScope;
    settings?: Partial<ExportSettingsValue>;
    format?: "png" | "jpg" | "webp";
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
  const mimeType =
    format === "jpg"
      ? "image/jpeg"
      : format === "webp"
        ? "image/webp"
        : "image/png";
  return await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new PngCaptureError("blob-failed"));
      },
      mimeType,
      mimeType === "image/png" ? undefined : 0.95,
    );
  });
}
