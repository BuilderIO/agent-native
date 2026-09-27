import { callAction } from "../use-action.js";

export interface EditorImageUploadResult {
  src: string;
  alt?: string;
  provider?: string;
}

export type EditorImageUploadFn = (
  file: File,
) => Promise<EditorImageUploadResult>;

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
  provider?: string;
}

export const uploadEditorImage: EditorImageUploadFn = async (file: File) => {
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
        "Image upload failed. Connect Builder.io (free tier available) in Settings → File uploads, then try again.",
    );
  }

  const alt = file.name ? file.name.replace(/\.[^./\\]+$/, "") : "";
  return { src: result.url, alt, provider: result.provider };
};
