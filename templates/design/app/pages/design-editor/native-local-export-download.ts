import type { NativeLocalExportState } from "@shared/native-local-export";
import { nativeLocalExportCropMatchesOptions } from "@shared/native-local-export";

import {
  NativeSceneExportError,
  renderSelectedNativeCodePackage,
  renderSelectedNativeHybridPdf,
  renderSelectedNativeHybridSvg,
  renderSelectedNativeSceneBlob,
  renderSelectedNativeSceneMp4Blob,
  renderSelectedNativeStandaloneHtml,
} from "./native-scene-export-client";
import { NativeLocalExportClientError } from "./use-native-local-export-requests";

type CapturePng = typeof renderSelectedNativeSceneBlob;
type CaptureMp4 = typeof renderSelectedNativeSceneMp4Blob;
type CaptureSvg = typeof renderSelectedNativeHybridSvg;
type CapturePdf = typeof renderSelectedNativeHybridPdf;
type CaptureHtml = typeof renderSelectedNativeStandaloneHtml;
type CaptureZip = typeof renderSelectedNativeCodePackage;
type LocalFailureCode = ConstructorParameters<
  typeof NativeLocalExportClientError
>[0];

class NativeLocalExportCaptureError extends NativeLocalExportClientError {
  constructor(
    code: LocalFailureCode,
    message: string,
    readonly cause: unknown,
  ) {
    super(code, message);
    this.name = "NativeLocalExportCaptureError";
  }
}

function readBoundedCaptureFailure(
  error: unknown,
):
  | { kind: "readable"; name: string; message: string; code?: string }
  | { kind: "absent" }
  | { kind: "unreadable" } {
  if (!error || typeof error !== "object") return { kind: "absent" };
  let name: unknown;
  let message: unknown;
  let code: unknown;
  try {
    name = Reflect.get(error, "name");
    message = Reflect.get(error, "message");
    code = Reflect.get(error, "code");
  } catch {
    return { kind: "unreadable" };
  }
  if (
    typeof name !== "string" ||
    (!(error instanceof Error) &&
      ![
        "Error",
        "TypeError",
        "RangeError",
        "DOMException",
        "NativeSourceError",
        "NativeRenderFailure",
        "NativeCompositionClockError",
        "NativeSceneMp4Error",
        "NativeSceneMp4CleanupError",
      ].includes(name)) ||
    typeof message !== "string" ||
    !message.trim()
  )
    return { kind: "absent" };
  const boundedMessage = message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 240);
  const nativeCode =
    (name === "NativeSourceError" || name === "NativeCompositionClockError") &&
    typeof code === "string" &&
    code.length <= 80 &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)
      ? code
      : undefined;
  return {
    kind: "readable",
    name,
    message: boundedMessage,
    ...(nativeCode && { code: nativeCode }),
  };
}

export async function runNativeLocalExportDownload(args: {
  request: NativeLocalExportState;
  signal: AbortSignal;
  download: (
    blob: Blob,
    extension: NativeLocalExportState["export"]["format"],
  ) => void;
  onProgress?: (completed: number, total: number) => void;
  capturePng?: CapturePng;
  captureMp4?: CaptureMp4;
  captureSvg?: CaptureSvg;
  capturePdf?: CapturePdf;
  captureHtml?: CaptureHtml;
  captureZip?: CaptureZip;
}): Promise<void> {
  const { request, signal } = args;
  if (request.status !== "running")
    throw new NativeLocalExportClientError(
      "client-unavailable",
      "The local export was not claimed by this editor.",
    );
  if (Date.now() >= request.expiresAt)
    throw new NativeLocalExportClientError(
      "client-unavailable",
      "The local export lease expired before capture.",
    );
  if (signal.aborted)
    throw new NativeLocalExportClientError("canceled", "Export was canceled.");
  if (
    !nativeLocalExportCropMatchesOptions(
      request.crop,
      request.export,
      request.sourceViewport,
    )
  )
    throw new NativeLocalExportClientError(
      "scene-unavailable",
      "The claimed native crop is unsupported for this format or viewport.",
    );

  let blob: Blob;
  try {
    if (request.export.format === "mp4") {
      blob = await (args.captureMp4 ?? renderSelectedNativeSceneMp4Blob)({
        designId: request.designId,
        fileId: request.fileId,
        viewport: request.export.viewport,
        settings: request.export.settings,
        expectedVersionHash: request.expectedVersionHash,
        crop: request.crop,
        sourceViewport: request.sourceViewport,
        signal,
        onProgress: args.onProgress,
      });
    } else {
      const source = {
        designId: request.designId,
        fileId: request.fileId,
        viewport: request.export.viewport,
        pixelRatio: request.export.pixelRatio,
        expectedVersionHash: request.expectedVersionHash,
        crop: request.crop,
        signal,
      };
      switch (request.export.format) {
        case "svg":
          blob = await (args.captureSvg ?? renderSelectedNativeHybridSvg)(
            source,
          );
          break;
        case "pdf":
          blob = await (args.capturePdf ?? renderSelectedNativeHybridPdf)(
            source,
          );
          break;
        case "html":
          blob = await (args.captureHtml ?? renderSelectedNativeStandaloneHtml)(
            source,
          );
          break;
        case "zip":
          blob = await (args.captureZip ?? renderSelectedNativeCodePackage)(
            source,
          );
          break;
        default:
          blob = await (args.capturePng ?? renderSelectedNativeSceneBlob)({
            ...source,
            sourceViewport: request.sourceViewport,
            format: request.export.format,
          });
      }
    }
  } catch (error) {
    if (signal.aborted)
      throw new NativeLocalExportClientError(
        "canceled",
        "Export was canceled.",
      );
    if (error instanceof NativeSceneExportError) {
      const code =
        error.code === "source-stale"
          ? "source-stale"
          : [
                "scene-unreadable",
                "frame-unavailable",
                "native-unavailable",
                "native-not-ready",
              ].includes(error.code)
            ? "scene-unavailable"
            : "render-failed";
      throw new NativeLocalExportCaptureError(code, error.message, error);
    }
    const details = readBoundedCaptureFailure(error);
    if (
      details.kind === "readable" &&
      (details.name === "NativeSceneMp4Error" ||
        details.name === "NativeSceneMp4CleanupError")
    )
      throw new NativeLocalExportCaptureError(
        "encode-failed",
        details.message,
        error,
      );
    throw new NativeLocalExportCaptureError(
      "render-failed",
      details.kind === "readable"
        ? `${details.code ? `${details.code}: ` : ""}${details.message}`
        : details.kind === "unreadable"
          ? "Local export failure details are unreadable."
          : "Local export failed.", // i18n-ignore agent-facing status fallback; editor feedback uses localized copy
      error,
    );
  }

  if (signal.aborted)
    throw new NativeLocalExportClientError("canceled", "Export was canceled.");
  if (Date.now() >= request.expiresAt)
    throw new NativeLocalExportClientError(
      "client-unavailable",
      "The local export lease expired before download.",
    );
  try {
    args.download(blob, request.export.format);
  } catch (error) {
    const details = readBoundedCaptureFailure(error);
    throw new NativeLocalExportCaptureError(
      "download-failed",
      details.kind === "readable"
        ? details.message
        : details.kind === "unreadable"
          ? "Local download failure details are unreadable."
          : "Local download failed.", // i18n-ignore agent-facing status fallback; editor feedback uses localized copy
      error,
    );
  }
}
