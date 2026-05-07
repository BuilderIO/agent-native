import { agentNativePath } from "@agent-native/core/client";

interface UploadResponse {
  url?: unknown;
  error?: unknown;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function getImageFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter(isImageFile);
}

export function hasImageFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (getImageFiles(dataTransfer.files).length > 0) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

export function imageUploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Image upload failed.";
}

export async function uploadImageFile(file: File): Promise<string> {
  if (!isImageFile(file)) {
    throw new Error("Only image files can be uploaded.");
  }

  const form = new FormData();
  form.append("file", file, file.name || "image");

  const response = await fetch(agentNativePath("/_agent-native/file-upload"), {
    method: "POST",
    body: form,
  });

  const body = (await response.json().catch(() => ({}))) as UploadResponse;

  if (!response.ok) {
    const serverMessage =
      typeof body.error === "string"
        ? body.error
        : `Image upload failed (${response.status}).`;
    if (
      response.status === 503 ||
      /file upload provider|storage provider|connect builder/i.test(
        serverMessage,
      )
    ) {
      throw new Error(
        "Image uploads need file storage. Connect Builder.io in Settings -> File uploads, then try again.",
      );
    }
    throw new Error(serverMessage);
  }

  if (typeof body.url !== "string" || !body.url) {
    throw new Error("Image upload returned no URL.");
  }

  return body.url;
}
