import { callAction } from "@agent-native/core/client/hooks";

import type { ExportSettingsValue } from "@/components/design/inspector";
import { NativeSceneExportError } from "@/pages/design-editor/native-scene-export-client";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import { resolveBoardExportCropRect } from "@/pages/design-editor/png-export-render";

import { parseEffectsFromHtml } from "../../../../shared/native-effects";
import { resolveNativeExportCrop } from "./native-export-crop";
import { pinNativeViewedSource } from "./native-viewed-source-version";
import {
  resolveSelectedScreenExportFrames,
  type RenderPngBlobArgs,
} from "./render-png-blob";

export type NativeHybridTarget = {
  designId: string;
  fileId: string;
  viewport: { width: number; height: number };
  pixelRatio: number;
  expectedVersionHash: string;
  assertStillViewed: () => void;
  crop?: NonNullable<ReturnType<typeof resolveNativeExportCrop>>;
};

async function readNativeSource(designId: string, fileId: string) {
  const result = await callAction<unknown>(
    "read-source-file",
    { designId, fileId },
    { method: "GET" },
  );
  if (!result || typeof result !== "object")
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected Design source could not be read for vector export.",
    );
  const source = result as Record<string, unknown>;
  if (
    source.designId !== designId ||
    source.fileId !== fileId ||
    typeof source.content !== "string" ||
    typeof source.versionHash !== "string" ||
    !source.versionHash
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected Design source identity is unreadable for vector export.",
    );
  const parsed = parseEffectsFromHtml(source.content);
  if (parsed.errors.length)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected Design native effect manifest is invalid.",
    );
  return {
    hasNativeEffects: Boolean(parsed.document?.instances.length),
    versionHash: source.versionHash,
  };
}

export async function resolveNativeHybridTarget(
  args: Pick<
    RenderPngBlobArgs,
    | "boardFileId"
    | "canvasFrameGeometryById"
    | "designId"
    | "overviewScreens"
    | "resolvePngCaptureTarget"
    | "selectedScreenIds"
    | "viewMode"
  > & {
    scope: PngCaptureScope;
    settings?: Partial<ExportSettingsValue>;
  },
): Promise<NativeHybridTarget | null> {
  const requested =
    args.scope === "screens" && args.viewMode === "overview"
      ? args.selectedScreenIds
      : [undefined];
  let nativeTarget: Awaited<
    ReturnType<RenderPngBlobArgs["resolvePngCaptureTarget"]>
  > | null = null;
  let sourcePin: ReturnType<typeof pinNativeViewedSource> | null = null;
  for (const screenId of requested) {
    const target = await args.resolvePngCaptureTarget(args.scope, screenId);
    if (!target.sourceFileId || !args.designId) {
      throw new NativeSceneExportError(
        "scene-unreadable",
        "The vector scene has no authoritative Design file identity.",
      );
    }
    const source = await readNativeSource(args.designId, target.sourceFileId);
    const viewedNative = Boolean(
      target.doc?.querySelector(
        'script[type="application/x-agent-native-effects"]',
      ),
    );
    if (!source.hasNativeEffects && viewedNative)
      throw new NativeSceneExportError(
        "source-stale",
        "The viewed native scene differs from its saved Design source.",
      );
    if (source.hasNativeEffects) {
      if (!target.doc || !viewedNative)
        throw new NativeSceneExportError(
          "scene-unreadable",
          "The selected preview cannot attest the saved native scene.",
        );
      const pin = pinNativeViewedSource({
        iframe: target.iframe,
        doc: target.doc,
      });
      if (pin.expectedVersionHash !== source.versionHash)
        throw new NativeSceneExportError(
          "source-stale",
          "The viewed native scene differs from its saved Design source.",
        );
      nativeTarget = target;
      sourcePin = pin;
      break;
    }
  }
  if (!nativeTarget || !sourcePin) return null;
  if (args.scope === "screens" && requested.length !== 1)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "Hybrid SVG and PDF need one complete native Design scene.",
    );
  const { iframe, sourceFileId } = nativeTarget;
  if (!args.designId || !sourceFileId)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The native vector scene has no authoritative Design file identity.",
    );
  const crop =
    args.scope === "element"
      ? resolveNativeExportCrop(nativeTarget.doc, nativeTarget.cropSelection)
      : null;
  if (
    !Number.isInteger(iframe.clientWidth) ||
    !Number.isInteger(iframe.clientHeight) ||
    iframe.clientWidth < 1 ||
    iframe.clientHeight < 1
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The native vector scene has no readable viewport.",
    );
  if (args.scope === "screens") {
    const selectedFrame = resolveSelectedScreenExportFrames({
      selectedScreenIds: [args.selectedScreenIds[0]!],
      overviewScreens: args.overviewScreens,
      canvasFrameGeometryById: args.canvasFrameGeometryById,
      iframeSizeById: new Map([
        [
          args.selectedScreenIds[0]!,
          { width: iframe.clientWidth, height: iframe.clientHeight },
        ],
      ]),
    })[0]?.frame;
    if (
      !selectedFrame ||
      Math.abs(selectedFrame.rotation) > 0.0001 ||
      Math.abs(selectedFrame.width - iframe.clientWidth) > 0.5 ||
      Math.abs(selectedFrame.height - iframe.clientHeight) > 0.5
    )
      throw new NativeSceneExportError(
        "scene-unreadable",
        "Native screen vector export needs a composed target for scaled or rotated frames.",
      );
  }
  if (
    args.scope === "document" &&
    args.boardFileId &&
    sourceFileId === args.boardFileId
  ) {
    const crop = resolveBoardExportCropRect(nativeTarget.doc!, iframe);
    if (
      crop &&
      (Math.abs(crop.x) > 0.5 ||
        Math.abs(crop.y) > 0.5 ||
        Math.abs(crop.width - iframe.clientWidth) > 0.5 ||
        Math.abs(crop.height - iframe.clientHeight) > 0.5)
    )
      throw new NativeSceneExportError(
        "scene-unreadable",
        "The native board needs a composed vector crop target.",
      );
  }
  return {
    designId: args.designId,
    fileId: sourceFileId,
    viewport: {
      width: crop?.width ?? iframe.clientWidth,
      height: crop?.height ?? iframe.clientHeight,
    },
    pixelRatio: args.settings?.scale ?? 1,
    ...sourcePin,
    ...(crop && { crop }),
  };
}
