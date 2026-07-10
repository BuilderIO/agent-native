/**
 * Resolve how to hand a dropped image to the agent chat.
 *
 * Prefer a hosted CDN URL from `/api/assets/upload` when a file-upload
 * provider is configured. When nothing is configured (or the upload fails),
 * fall back to an inline data URL so the agent can still see the image —
 * chat already accepts `images: string[]` data URLs without a storage
 * provider. The agent can call `upload-image` later if the slide needs a
 * durable hosted URL.
 */

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
      referenceImagePaths: string[];
    }
  | {
      kind: "inline";
      message: string;
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
  const intentLine =
    args.intent.trim().length > 0
      ? args.intent.trim()
      : "Use this image on the current slide.";
  const lines = [intentLine];
  if (args.contextHint && args.contextHint.trim().length > 0) {
    lines.push(args.contextHint.trim());
  }
  lines.push(`Filename: ${args.filename}`);

  if (args.upload.ok && args.upload.url) {
    lines.splice(
      lines.length - 1,
      0,
      `Image URL (already uploaded): ${args.upload.url}`,
    );
    return {
      kind: "hosted",
      message: lines.join("\n\n"),
      referenceImagePaths: [args.upload.url],
    };
  }

  if (!args.dataUrl) {
    throw new Error(
      args.upload.error ||
        "Image upload failed. Connect Builder.io from the agent composer model menu, or register a custom provider via registerFileUploadProvider().",
    );
  }

  if (!isMissingUploadProviderError(args.upload.status, args.upload.error)) {
    // Unexpected upload failure — still try the inline path so the user can
    // keep working, but tell the agent the hosted upload didn't land.
    lines.push(
      "Hosted upload failed; the image is attached inline as a data URL. Call upload-image on it before placing it on the slide if a durable URL is required.",
    );
  } else {
    lines.push(
      "No file upload provider is configured, so the image is attached inline as a data URL. Call upload-image to obtain a hosted URL before inserting it into slide HTML.",
    );
  }

  return {
    kind: "inline",
    message: lines.join("\n\n"),
    images: [args.dataUrl],
  };
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
