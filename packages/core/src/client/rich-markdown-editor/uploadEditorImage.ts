import type { ImageUploadFn } from "@agent-native/toolkit/editor";

import { callAction } from "../use-action.js";

/**
 * Read a {@link File} as a base64 data URL (`data:image/...;base64,...`).
 *
 * The framework `upload-image` action accepts a data URL (`data`) or a remote
 * URL (`url`) — not raw multipart — so a browser file-picker must convert the
 * File to a data URL first.
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
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

interface UploadImageActionResult {
  url?: string;
  error?: string;
  configured?: boolean;
}

/**
 * The shared editor's default image uploader: upload a picked / pasted /
 * dropped image File through the framework `upload-image` action and return the
 * hosted CDN URL.
 *
 * This is the {@link ImageUploadFn} embedders pass to the shared image block so
 * any app gets a real uploading image block with zero per-app upload code. The
 * action re-hosts the bytes on the configured provider (Builder.io by default),
 * is session-scoped, and returns a stable `![alt](url)` source — so a plan's
 * inserted image autosaves as plain markdown through the existing
 * `update-rich-text` path with no new persistence channel.
 *
 * @throws when the file cannot be read, the action returns no URL, or upload is
 *   not configured (with the action's "connect Builder.io" guidance).
 */
export const uploadEditorImage: ImageUploadFn = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }

  const dataUrl = await fileToDataUrl(file);

  const result = await callAction<UploadImageActionResult>("upload-image", {
    data: dataUrl,
    filename: file.name || undefined,
  });

  if (!result || typeof result.url !== "string" || !result.url) {
    throw new Error(
      result?.error ||
        "Image upload failed. Connect Builder.io in Settings → File uploads, then try again.",
    );
  }

  // Use the filename (sans extension) as a reasonable default alt text.
  const alt = file.name ? file.name.replace(/\.[^./\\]+$/, "") : "";
  return { src: result.url, alt };
};
