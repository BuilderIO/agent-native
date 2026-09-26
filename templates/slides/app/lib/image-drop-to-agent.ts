
import {
  estimateAttachmentBodyBytes,
  MAX_ESTIMATED_BODY_BYTES,
} from "@agent-native/core/client/chat";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../../shared/upload-types";

export interface HostedImageUploadResult {
  ok: boolean;
  status: number;
  url?: string;
  error?: string;
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
  status: number,
  error: string | undefined,
): boolean {
  if (status === 503) return true;
  const lower = (error ?? "").toLowerCase();
  return (
    lower.includes("no file upload provider") ||
    lower.includes("registerfileuploadprovider") ||
    lower.includes("connect builder.io")
  );
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

  if (!inlineDataUrl) {
    throw new Error(
      args.upload.error ||
        "Image upload failed. Connect Builder.io (free tier available) from the agent composer model menu, or register a custom provider via registerFileUploadProvider().",
    );
  }

  if (!isMissingUploadProviderError(args.upload.status, args.upload.error)) {
    contextLines.push(
      "Hosted upload failed; the image is attached inline as a data URL. Call upload-image on it before placing it on the slide if a durable URL is required.",
    );
  } else {
    contextLines.push(
      "No file upload provider is configured, so the image is attached inline as a data URL. Call upload-image to obtain a hosted URL before inserting it into slide HTML.",
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
  const match = /^data:(image\/[^;]+);base64,(.*)$/is.exec(dataUrl);
  const mediaType = match?.[1]?.trim().toLowerCase();
  return Boolean(
    match &&
    mediaType &&
    mediaType !== "image/svg+xml" &&
    match[2].length + `data:${mediaType};base64,`.length <=
      MAX_INLINE_IMAGE_BASE64_CHARS,
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
