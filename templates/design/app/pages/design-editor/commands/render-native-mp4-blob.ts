import type { CanvasFrameGeometryById } from "@shared/canvas-frames";

import type { ElementInfo } from "@/components/design/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { ExportCaptureTarget } from "@/pages/design-editor/export-snapshot-frame";
import {
  NativeSceneExportError,
  renderSelectedNativeSceneMp4Blob,
  type NativeVideoSettings,
} from "@/pages/design-editor/native-scene-export-client";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import { resolveBoardExportCropRect } from "@/pages/design-editor/png-export-render";

import { resolveNativeExportCrop } from "./native-export-crop";
import { pinNativeViewedSource } from "./native-viewed-source-version";
import { resolveSelectedScreenExportFrames } from "./render-png-blob";

export async function runRenderNativeMp4Blob(args: {
  designId?: string;
  boardFileId?: string;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  overviewScreens: OverviewScreen[];
  selectedScreenIds: string[];
  viewMode: "single" | "overview";
  resolvePngCaptureTarget: (
    scope: PngCaptureScope,
    screenId?: string,
  ) =>
    | (ExportCaptureTarget & {
        sourceFileId?: string;
        cropSelection?: ElementInfo | readonly ElementInfo[] | null;
      })
    | Promise<
        ExportCaptureTarget & {
          sourceFileId?: string;
          cropSelection?: ElementInfo | readonly ElementInfo[] | null;
        }
      >;
  settings: NativeVideoSettings;
  scope: PngCaptureScope;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}): Promise<Blob> {
  if (!args.designId)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native scene has no Design identity.",
    );
  const screenId =
    args.scope === "screens" &&
    args.viewMode === "overview" &&
    args.selectedScreenIds.length === 1
      ? args.selectedScreenIds[0]
      : undefined;
  if (args.scope === "screens" && !screenId)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "Native video export requires exactly one selected screen.",
    );
  const target = await args.resolvePngCaptureTarget(
    screenId ? "screens" : args.scope,
    screenId,
  );
  if (
    !target.doc?.querySelector(
      'script[type="application/x-agent-native-effects"]',
    ) ||
    !target.sourceFileId
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected screen has no authoritative native effect source.",
    );
  const sourcePin = pinNativeViewedSource({
    iframe: target.iframe,
    doc: target.doc,
  });
  const sourceViewport = {
    width: target.iframe.clientWidth,
    height: target.iframe.clientHeight,
  };
  const assertStillViewed = () => {
    sourcePin.assertStillViewed();
    if (
      target.iframe.clientWidth !== sourceViewport.width ||
      target.iframe.clientHeight !== sourceViewport.height
    )
      throw new NativeSceneExportError(
        "source-stale",
        "The mounted Design viewport changed during native video export.",
      );
  };
  const crop =
    args.scope === "element"
      ? resolveNativeExportCrop(target.doc, target.cropSelection ?? null)
      : null;
  if (screenId) {
    const frame = resolveSelectedScreenExportFrames({
      selectedScreenIds: [screenId],
      overviewScreens: args.overviewScreens,
      canvasFrameGeometryById: args.canvasFrameGeometryById,
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
      !frame ||
      Math.abs(frame.rotation) > 0.0001 ||
      Math.abs(frame.width - target.iframe.clientWidth) > 0.5 ||
      Math.abs(frame.height - target.iframe.clientHeight) > 0.5
    )
      throw new NativeSceneExportError(
        "scene-unreadable",
        "Native video export needs a composed geometry target for scaled or rotated screens.",
      );
  }
  if (
    args.scope === "document" &&
    args.boardFileId &&
    target.sourceFileId === args.boardFileId
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
        "The selected board needs an explicit native crop target for video export.",
      );
  }
  return renderSelectedNativeSceneMp4Blob({
    designId: args.designId,
    fileId: target.sourceFileId,
    expectedVersionHash: sourcePin.expectedVersionHash,
    assertStillViewed,
    viewport: {
      width: crop?.width ?? sourceViewport.width,
      height: crop?.height ?? sourceViewport.height,
    },
    ...(crop && { crop, sourceViewport }),
    settings: args.settings,
    signal: args.signal,
    onProgress: args.onProgress,
  });
}
