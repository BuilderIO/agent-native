import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { normalizeDesignSourceType } from "@shared/source-mode";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getExportCompositeBounds,
  resolveRasterExportScale,
} from "@/pages/design-editor/export-capture";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import {
  PngCaptureError,
  cropCanvasToRect,
  renderExportDocumentCanvas,
  resolveExportCropRect,
} from "@/pages/design-editor/png-export-render";

export interface RenderPngBlobArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  overviewScreens: OverviewScreen[];
  resolvePngCaptureTarget: (scope: PngCaptureScope) => {
    cropSelection: ElementInfo | readonly ElementInfo[] | null;
    doc: Document;
    iframe: HTMLIFrameElement;
  };
  selectedScreenIds: string[];
  viewMode: "single" | "overview";
}

export async function runRenderPngBlob(
  {
    activeCanvasSourceType,
    canEditDesign,
    canvasFrameGeometryById,
    overviewScreens,
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
  const html2canvas = (await import("html2canvas")).default;
  const requestedExportScale =
    settings?.scale ?? Math.max(2, window.devicePixelRatio || 1);
  let outputCanvas: HTMLCanvasElement;

  if (
    scope === "screens" &&
    viewMode === "overview" &&
    selectedScreenIds.length > 0
  ) {
    const captures = selectedScreenIds
      .map((screenId, order) => {
        const iframe = document.querySelector<HTMLIFrameElement>(
          `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
        );
        if (!iframe) throw new PngCaptureError("no-preview");
        let doc: Document | null = null;
        try {
          doc = iframe.contentDocument;
          if (!doc?.documentElement) doc = null;
        } catch {
          doc = null;
        }
        if (!doc) {
          const sourceType =
            normalizeDesignSourceType(iframe.dataset.designSourceType) ??
            activeCanvasSourceType;
          if (sourceType !== "inline") {
            throw new PngCaptureError("external-preview");
          }
          if (!canEditDesign) {
            throw new PngCaptureError("read-only-preview");
          }
          throw new PngCaptureError("no-preview");
        }
        const screen = overviewScreens.find(
          (candidate) => candidate.id === screenId,
        );
        const geometry = canvasFrameGeometryById[screenId] ?? {};
        return {
          doc,
          frame: {
            x: geometry.x ?? order * ((screen?.width ?? 1440) + 80),
            y: geometry.y ?? 0,
            width: Math.max(
              1,
              geometry.width ?? screen?.width ?? iframe.clientWidth,
            ),
            height: Math.max(
              1,
              geometry.height ?? screen?.height ?? iframe.clientHeight,
            ),
            rotation: geometry.rotation ?? 0,
          },
          iframe,
          order,
          z: geometry.z ?? order,
        };
      })
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
      const rendered = await renderExportDocumentCanvas({
        doc: capture.doc,
        iframe: capture.iframe,
        exportScale,
        render: html2canvas,
      });
      const view = capture.doc.defaultView;
      const viewportCanvas = cropCanvasToRect(
        rendered.canvas,
        {
          x: view?.scrollX ?? 0,
          y: view?.scrollY ?? 0,
          width: Math.max(1, capture.iframe.clientWidth),
          height: Math.max(1, capture.iframe.clientHeight),
        },
        rendered.scale,
      );
      const frame = capture.frame;
      context.save();
      context.translate(
        (frame.x + frame.width / 2 - bounds.x) * exportScale,
        (frame.y + frame.height / 2 - bounds.y) * exportScale,
      );
      context.rotate(((frame.rotation ?? 0) * Math.PI) / 180);
      context.drawImage(
        viewportCanvas ?? rendered.canvas,
        (-frame.width / 2) * exportScale,
        (-frame.height / 2) * exportScale,
        frame.width * exportScale,
        frame.height * exportScale,
      );
      context.restore();
    }
  } else {
    const { cropSelection, doc, iframe } = resolvePngCaptureTarget(scope);
    const rendered = await renderExportDocumentCanvas({
      doc,
      iframe,
      exportScale: requestedExportScale,
      render: html2canvas,
    });
    const cropRect = resolveExportCropRect(doc, cropSelection);
    const cropped = cropRect
      ? cropCanvasToRect(rendered.canvas, cropRect, rendered.scale)
      : null;
    // An element capture that silently widens to the whole document is a
    // preview of something the user did not ask to export, and nothing
    // downstream can tell it apart from a real one.
    if (scope === "element" && !cropped) {
      throw new PngCaptureError("no-preview");
    }
    // Render the whole page first, then crop, so ancestor backgrounds show
    // through every selected frame exactly as they do on screen.
    outputCanvas = cropped ?? rendered.canvas;
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
