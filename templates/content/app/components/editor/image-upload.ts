import { agentNativePath } from "@agent-native/core/client";

interface UploadResponse {
  url?: unknown;
  error?: unknown;
  message?: unknown;
  statusMessage?: unknown;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

type MediaUploadKind = "image" | "video" | "audio";

function mediaUploadLabel(kind: MediaUploadKind) {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  return "Audio";
}

export function getImageFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter(isImageFile);
}

export function getVideoFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter(isVideoFile);
}

export function getAudioFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter(isAudioFile);
}

export function hasImageFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (getImageFiles(dataTransfer.files).length > 0) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

export function hasVideoFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (getVideoFiles(dataTransfer.files).length > 0) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("video/"),
  );
}

export function hasAudioFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (getAudioFiles(dataTransfer.files).length > 0) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("audio/"),
  );
}

export function imageUploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Image upload failed."; // i18n-ignore fallback for non-React upload helper
}

export function videoUploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Video upload failed."; // i18n-ignore fallback for non-React upload helper
}

export function audioUploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Audio upload failed."; // i18n-ignore fallback for non-React upload helper
}

function uploadResponseMessage(
  response: Response,
  body: UploadResponse,
  kind: MediaUploadKind = "image",
): string {
  for (const value of [body.error, body.message, body.statusMessage]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return `${mediaUploadLabel(kind)} upload failed (${response.status}).`;
}

function isBuilderReconnectError(serverMessage: string): boolean {
  return /builder(?:\.io)?[^\n]*(auth|credential|token|upload failed|401|403|unauthorized|forbidden|invalid)/i.test(
    serverMessage,
  );
}

async function uploadMediaFile(
  file: File,
  kind: MediaUploadKind,
): Promise<string> {
  const isValidFile =
    kind === "image"
      ? isImageFile(file)
      : kind === "video"
        ? isVideoFile(file)
        : isAudioFile(file);
  if (!isValidFile) {
    throw new Error(`Only ${kind} files can be uploaded.`);
  }

  const form = new FormData();
  form.append("file", file, file.name || kind);

  const response = await fetch(agentNativePath("/_agent-native/file-upload"), {
    method: "POST",
    body: form,
  });

  const body = (await response.json().catch(() => ({}))) as UploadResponse;

  if (!response.ok) {
    const serverMessage = uploadResponseMessage(response, body, kind);
    if (isBuilderReconnectError(serverMessage)) {
      throw new Error(
        "Builder.io is connected, but the saved connection was rejected. Reconnect Builder.io in Settings -> File uploads, then try again.",
      );
    }
    if (
      response.status === 503 ||
      /file upload provider|storage provider|connect builder/i.test(
        serverMessage,
      )
    ) {
      throw new Error(
        `${mediaUploadLabel(kind)} uploads need file storage. Connect Builder.io in Settings -> File uploads, then try again.`,
      );
    }
    throw new Error(serverMessage);
  }

  if (typeof body.url !== "string" || !body.url) {
    throw new Error(`${mediaUploadLabel(kind)} upload returned no URL.`);
  }

  return body.url;
}

export async function uploadImageFile(file: File): Promise<string> {
  return uploadMediaFile(file, "image");
}

export async function uploadVideoFile(file: File): Promise<string> {
  return uploadMediaFile(file, "video");
}

export async function uploadAudioFile(file: File): Promise<string> {
  return uploadMediaFile(file, "audio");
}
