import { useSyncExternalStore } from "react";

/**
 * Images this tab is uploading, drawn from the picked file while they upload
 * so a block shows its image at once. The preview lives only here, never in
 * the page: its `blob:` URL means nothing to another reader of the page, or to
 * this tab after a reload, so they see the block as it is in the page.
 *
 * Each entry is keyed by the upload's id without its prefix, so a block keeps
 * its preview as its id moves between `image-upload-…` and `image-failed-…`.
 */
export interface ImageUploadPreview {
  /** Null when this browser can't make a URL for the file. */
  url: string | null;
  /**
   * Why the upload stopped, so the block offers Retry and Remove: the file
   * didn't upload, or its uploaded copy wouldn't draw.
   */
  failure: "upload" | "render" | null;
}

interface HeldPreview {
  preview: ImageUploadPreview;
  owner: object;
  running: boolean;
  /** Its block was deleted while it uploaded, so it mustn't come back. */
  removed: boolean;
  retry: (() => void) | null;
}

const UPLOAD_PREFIX = "image-upload-";
const FAILED_PREFIX = "image-failed-";

const held = new Map<string, HeldPreview>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

function previewKey(uploadId: unknown): string | null {
  if (typeof uploadId !== "string") return null;
  if (uploadId.startsWith(UPLOAD_PREFIX)) {
    return uploadId.slice(UPLOAD_PREFIX.length);
  }
  if (uploadId.startsWith(FAILED_PREFIX)) {
    return uploadId.slice(FAILED_PREFIX.length);
  }
  return null;
}

export function isFailedImageUploadId(uploadId: unknown): boolean {
  return typeof uploadId === "string" && uploadId.startsWith(FAILED_PREFIX);
}

/** The id a block carries once its upload stops. */
export function failedImageUploadId(uploadId: string): string {
  return `${FAILED_PREFIX}${previewKey(uploadId) ?? uploadId}`;
}

function setFailure(
  entry: HeldPreview,
  failure: ImageUploadPreview["failure"],
) {
  if (entry.preview.failure === failure) return;
  entry.preview = { ...entry.preview, failure };
  notify();
}

/**
 * Starts showing `file` in the block for `uploadId`. `owner` is the editor
 * that made it, so closing that editor lets its previews go.
 */
export function holdImageUploadPreview(
  uploadId: string,
  file: File,
  owner: object,
) {
  const key = previewKey(uploadId);
  if (!key || held.has(key)) return;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
  } catch {
    url = null;
  }
  held.set(key, {
    preview: { url, failure: null },
    owner,
    running: false,
    removed: false,
    retry: null,
  });
  notify();
}

export function hasImageUploadPreview(uploadId: unknown): boolean {
  const key = previewKey(uploadId);
  return key !== null && held.has(key);
}

export function hasAnyImageUploadPreview(): boolean {
  return held.size > 0;
}

export function startImageUploadPreview(uploadId: string) {
  const key = previewKey(uploadId);
  const entry = key ? held.get(key) : undefined;
  if (!key || !entry) return;
  entry.running = true;
  entry.removed = false;
  entry.retry = null;
  setFailure(entry, null);
}

/** Keeps the preview after a failed upload, with what Retry does. */
export function failImageUploadPreview(
  uploadId: string,
  failure: "upload" | "render",
  retry: () => void,
) {
  const key = previewKey(uploadId);
  const entry = key ? held.get(key) : undefined;
  if (!key || !entry) return;
  entry.running = false;
  entry.retry = retry;
  setFailure(entry, failure);
}

export function releaseImageUploadPreview(uploadId: unknown) {
  const key = previewKey(uploadId);
  const entry = key ? held.get(key) : undefined;
  if (!key || !entry) return;
  held.delete(key);
  if (entry.preview.url) URL.revokeObjectURL(entry.preview.url);
  notify();
}

/** Lets go of every preview `owner` made, as its editor closes. */
export function releaseImageUploadPreviewsFor(owner: object) {
  for (const [key, entry] of [...held]) {
    if (entry.owner !== owner) continue;
    held.delete(key);
    if (entry.preview.url) URL.revokeObjectURL(entry.preview.url);
  }
  notify();
}

/**
 * The user deleted the block for `uploadId`. A running upload then ends
 * without putting the block back; a stopped one has nothing left to show.
 */
export function noteImageUploadBlockRemoved(uploadId: unknown) {
  const key = previewKey(uploadId);
  const entry = key ? held.get(key) : undefined;
  if (!key || !entry) return;
  if (entry.running) {
    entry.removed = true;
    return;
  }
  releaseImageUploadPreview(uploadId);
}

export function wasImageUploadBlockRemoved(uploadId: string): boolean {
  const key = previewKey(uploadId);
  return key !== null && held.get(key)?.removed === true;
}

export function retryImageUpload(uploadId: unknown) {
  const key = previewKey(uploadId);
  held.get(key ?? "")?.retry?.();
}

export function useImageUploadPreview(
  uploadId: unknown,
): ImageUploadPreview | null {
  const key = previewKey(uploadId);
  return useSyncExternalStore(
    subscribe,
    () => (key ? (held.get(key)?.preview ?? null) : null),
    () => null,
  );
}
