import { agentNativePath } from "@agent-native/core/client/api-path";

interface UploadResponse {
  url?: unknown;
  error?: unknown;
  message?: unknown;
  statusMessage?: unknown;
}

function normalizeImageFile(file: File): File | null {
  const mimeType = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (/\.svg$/i.test(file.name)) {
    if (mimeType === "image/svg+xml") return file;
    if (mimeType === "" || mimeType === "application/octet-stream") {
      return new File([file], file.name, {
        type: "image/svg+xml",
        lastModified: file.lastModified,
      });
    }
    return null;
  }
  return mimeType.startsWith("image/") ? file : null;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

type MediaUploadKind = "image" | "video" | "audio";

const IMAGE_LOAD_TIMEOUT_MS = 15_000;

export class ImageRenderError extends Error {
  constructor() {
    super("Image could not be loaded.");
    this.name = "ImageRenderError";
  }
}

export class ImagePersistenceError extends Error {
  constructor() {
    super("Image could not be saved.");
    this.name = "ImagePersistenceError";
  }
}

export function waitForRenderedImage(
  findImage: () => HTMLImageElement | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let image: HTMLImageElement | null = null;
    let frame = 0;
    const timeout = window.setTimeout(
      () => finish(false),
      IMAGE_LOAD_TIMEOUT_MS,
    );

    function cleanup() {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
      if (image) {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
      }
    }

    function finish(loaded: boolean) {
      cleanup();
      if (loaded) resolve();
      else reject(new ImageRenderError());
    }

    function handleLoad() {
      frame = window.requestAnimationFrame(observe);
    }

    function handleError() {
      finish(false);
    }

    function observe() {
      image = findImage();
      if (!image) {
        frame = window.requestAnimationFrame(observe);
        return;
      }
      if (image.complete) {
        if (image.naturalWidth <= 0) {
          finish(false);
          return;
        }
        const bounds = image.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) {
          finish(true);
          return;
        }
        frame = window.requestAnimationFrame(observe);
        return;
      }
      image.addEventListener("load", handleLoad, { once: true });
      image.addEventListener("error", handleError, { once: true });
    }

    observe();
  });
}

export async function completeImageFileUpload({
  file,
  stageAttributes,
  waitForRender,
  commitAttributes,
  persistCommittedImage,
  upload = uploadImageFile,
}: {
  file: File;
  stageAttributes: (src: string) => void;
  waitForRender: () => Promise<void>;
  commitAttributes: (src: string) => void;
  persistCommittedImage: () => boolean | Promise<boolean>;
  upload?: (file: File) => Promise<string>;
}): Promise<string> {
  const src = await upload(file);
  stageAttributes(src);
  await waitForRender();
  commitAttributes(src);
  if (!(await persistCommittedImage())) throw new ImagePersistenceError();
  return src;
}

export function createMediaUploadId(kind: MediaUploadKind): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${kind}-upload-${random}`;
}

export function createImagePickerId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `image-picker-${random}`;
}

function mediaUploadLabel(kind: MediaUploadKind) {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  return "Audio";
}

export function getImageFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).flatMap((file) => {
    const normalized = normalizeImageFile(file);
    return normalized ? [normalized] : [];
  });
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
      ? normalizeImageFile(file) !== null
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
        "Builder.io is connected, but the saved connection was rejected. Reconnect Builder.io in Settings -> File uploads (free tier available), then try again.",
      );
    }
    if (
      response.status === 503 ||
      /file upload provider|storage provider|connect builder/i.test(
        serverMessage,
      )
    ) {
      throw new Error(
        `${mediaUploadLabel(kind)} uploads need file storage. Connect Builder.io in Settings -> File uploads (free tier available), then try again.`,
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
  const normalized = normalizeImageFile(file);
  if (!normalized) throw new Error("Only image files can be uploaded.");
  return uploadMediaFile(normalized, "image");
}

export async function uploadVideoFile(file: File): Promise<string> {
  return uploadMediaFile(file, "video");
}

export async function uploadAudioFile(file: File): Promise<string> {
  return uploadMediaFile(file, "audio");
}
