import { parseBase64DataUrl } from "@agent-native/core/shared";
import {
  estimateAttachmentBodyBytes,
  MAX_ESTIMATED_BODY_BYTES,
} from "@agent-native/toolkit/composer/attachment-accept";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../../shared/upload-types";

export interface HostedImageUploadResult {
  ok: boolean;
  status: number;
  url?: string;
  error?: string;
  errorCode?: string;
}

export type ImageDropAgentPayload =
  | {
      kind: "hosted";
      message: string;
      context: string;
      referenceImagePaths: string[];
      images?: string[];
    }
  | {
      kind: "inline";
      message: string;
      context: string;
      images: string[];
    };

export function isMissingUploadProviderError(
  _status: number,
  error: string | undefined,
  errorCode?: unknown,
): boolean {
  if (errorCode === "image_upload_storage_unavailable") return true;
  const lower = (error ?? "").toLowerCase();
  return (
    lower.includes("no object storage is connected") ||
    lower.includes("no file upload provider") ||
    lower.includes("registerfileuploadprovider") ||
    lower.includes("connect builder.io") ||
    lower.includes("use builder.io") ||
    lower.includes("connect file storage before uploading images")
  );
}

export function isStorageSetupRequiredError(error: unknown): boolean {
  // Typed first: the server says who can fix storage, and "nobody connected
  // it" is the workspace admin's setup, whatever the message says.
  const typed = error as {
    errorCode?: unknown;
    details?: { whoCanFix?: unknown } | null;
  } | null;
  if (typed?.errorCode === "image_upload_storage_unavailable") return true;
  if (typed?.errorCode === "attachment_storage_unavailable") {
    return typed.details?.whoCanFix === "workspace_admin";
  }
  // Image-generation providers may still report missing storage in prose.
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : undefined;
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : 0;
  return isMissingUploadProviderError(status, message, typed?.errorCode);
}

export function buildImageDropAgentPayload(args: {
  intent: string;
  contextHint?: string;
  filename: string;
  upload: HostedImageUploadResult;
  dataUrl?: string;
}): ImageDropAgentPayload {
  const inlineDataUrl =
    args.dataUrl && canInlineImageDataUrl(args.dataUrl)
      ? args.dataUrl
      : undefined;
  const intentLine =
    args.intent.length > 0
      ? args.intent
      : "Use this image on the current slide.";
  const contextLines: string[] = [];
  if (args.contextHint && args.contextHint.trim().length > 0) {
    contextLines.push(args.contextHint.trim());
  }
  contextLines.push(`Filename: ${args.filename}`);

  if (args.upload.ok && args.upload.url) {
    contextLines.push(`Image URL (already uploaded): ${args.upload.url}`);
    if (inlineDataUrl) {
      contextLines.push(
        "The original image is also attached for visual inspection.",
      );
    }
    return {
      kind: "hosted",
      message: intentLine,
      context: contextLines.join("\n\n"),
      referenceImagePaths: [args.upload.url],
      ...(inlineDataUrl ? { images: [inlineDataUrl] } : {}),
    };
  }

  if (
    isMissingUploadProviderError(
      args.upload.status,
      args.upload.error,
      args.upload.errorCode,
    )
  ) {
    throw Object.assign(
      new Error(
        args.upload.error ||
          "Connect object storage to upload images: Builder.io (free) or your own S3-compatible storage keys.",
      ),
      {
        ...(args.upload.errorCode ? { errorCode: args.upload.errorCode } : {}),
      },
    );
  }

  if (!inlineDataUrl) {
    throw Object.assign(
      new Error(
        args.upload.error ||
          "Image upload failed. Use Builder.io (free) or configure your own S3-compatible storage keys.",
      ),
      {
        ...(args.upload.errorCode ? { errorCode: args.upload.errorCode } : {}),
      },
    );
  }

  if (
    !isMissingUploadProviderError(
      args.upload.status,
      args.upload.error,
      args.upload.errorCode,
    )
  ) {
    contextLines.push(
      "Hosted upload failed; the image is attached inline as a data URL. Call upload-image on it before placing it on the slide if a durable URL is required.",
    );
  }

  return {
    kind: "inline",
    message: intentLine,
    context: contextLines.join("\n\n"),
    images: [inlineDataUrl],
  };
}

export function canInlineImageFile(file: File): boolean {
  const mediaType = file.type || "application/octet-stream";
  if (mediaType.split(";", 1)[0]?.trim().toLowerCase() === "image/svg+xml") {
    return false;
  }
  if (/\.svg$/i.test(file.name)) return false;
  const encodedLength = Math.ceil(file.size / 3) * 4;
  return (
    encodedLength + `data:${mediaType};base64,`.length <=
    MAX_INLINE_IMAGE_BASE64_CHARS
  );
}

export function canInlineImageDataUrl(dataUrl: string): boolean {
  const parsed = parseBase64DataUrl(dataUrl);
  return Boolean(
    parsed &&
    parsed.mediaType.startsWith("image/") &&
    parsed.mediaType !== "image/svg+xml" &&
    dataUrl.length <= MAX_INLINE_IMAGE_BASE64_CHARS,
  );
}

export function canAddInlineImageToPayload(
  existingDataUrls: readonly string[],
  candidate: string,
): boolean {
  return (
    canInlineImageDataUrl(candidate) &&
    estimateAttachmentBodyBytes([...existingDataUrls, candidate]) <=
      MAX_ESTIMATED_BODY_BYTES
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:")) {
        resolve(result);
      } else {
        reject(new Error("Failed to read image file."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}
