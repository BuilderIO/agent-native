import { callActionBlob } from "@agent-native/core/client/hooks";

import type { ExportCropRect } from "./export-capture";

const MAX_RENDER_REQUEST_BYTES = 5_000_000;
const RENDER_ERROR_FALLBACK = "PNG export rendering failed."; // i18n-ignore: Logged only; the UI shows localized generic copy.

export class NativeExportRenderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "NativeExportRenderError";
  }
}

export async function renderNativeExportPng(args: {
  html: string;
  width: number;
  height: number;
  scale: number;
  clip?: ExportCropRect;
}): Promise<Blob> {
  const body = JSON.stringify(args);
  if (new TextEncoder().encode(body).byteLength > MAX_RENDER_REQUEST_BYTES) {
    throw new NativeExportRenderError(
      "PNG export request exceeds the 5 MB limit.",
      "export_too_large",
    );
  }
  let png: Blob;
  try {
    png = await callActionBlob("render-export-png", args, {
      timeoutMs: 45_000,
    });
  } catch (error) {
    const serverErrorCode =
      typeof error === "object" &&
      error !== null &&
      "errorCode" in error &&
      typeof error.errorCode === "string"
        ? error.errorCode
        : undefined;
    const timedOut =
      typeof error === "object" &&
      error !== null &&
      "timedOut" in error &&
      error.timedOut === true;
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : undefined;
    const errorCode =
      serverErrorCode ??
      (timedOut
        ? "export_render_timeout"
        : status === 413
          ? "export_too_large"
          : undefined);
    if (errorCode) {
      throw new NativeExportRenderError(
        error instanceof Error ? error.message : RENDER_ERROR_FALLBACK,
        errorCode,
      );
    }
    throw error;
  }
  if (!png.type.startsWith("image/png")) {
    throw new Error("PNG export renderer returned an invalid image.");
  }
  return png;
}
