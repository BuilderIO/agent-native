import {
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import type { ClipUploadTicket } from "@shared/clips-peer-contract";
import { useSyncExternalStore } from "react";

export const CLIP_UPLOADS_APP_STATE_KEY = "content-clip-uploads";

/**
 * An upload this tab is sending to Clips. It lives only in this tab: another
 * reader of the page, or this one after a reload, learns how the Clip is
 * doing from Clips.
 */
export type ClipUpload = {
  recordingId: string;
  documentId: string;
  fileName: string;
} & (
  | { phase: "uploading"; sentBytes: number; totalBytes: number }
  /** Clips has every byte and is making the Clip. */
  | { phase: "making" }
  | { phase: "failed" }
);

const uploads = new Map<string, ClipUpload>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clipUploadPercent(upload: ClipUpload): number | null {
  return upload.phase === "uploading"
    ? Math.floor((upload.sentBytes / Math.max(1, upload.totalBytes)) * 100)
    : null;
}

/** What the agent sees through `view-screen`: names and progress, no bytes. */
function writeUploadsState() {
  const value =
    uploads.size === 0
      ? null
      : {
          uploads: [...uploads.values()].map((upload) => ({
            recordingId: upload.recordingId,
            documentId: upload.documentId,
            fileName: upload.fileName,
            phase: upload.phase,
            percent: clipUploadPercent(upload),
          })),
        };
  const tabId = getBrowserTabId();
  for (const key of [
    appStateKeyForBrowserTab(CLIP_UPLOADS_APP_STATE_KEY, tabId),
    CLIP_UPLOADS_APP_STATE_KEY,
  ]) {
    void setClientAppState(key, value, {
      keepalive: true,
      requestSource: tabId,
    });
  }
}

function warnBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault();
}

function set(upload: ClipUpload | null, recordingId: string) {
  const before = uploads.get(recordingId);
  if (upload) uploads.set(recordingId, upload);
  else uploads.delete(recordingId);

  const sending = [...uploads.values()].some(
    (each) => each.phase === "uploading",
  );
  window.removeEventListener("beforeunload", warnBeforeLeaving);
  if (sending) window.addEventListener("beforeunload", warnBeforeLeaving);

  // Progress moves every chunk; the agent needs it every tenth.
  const step = (each: ClipUpload | undefined | null) =>
    each
      ? `${each.phase}:${Math.floor((clipUploadPercent(each) ?? 0) / 10)}`
      : null;
  if (step(before) !== step(upload)) writeUploadsState();
  for (const listener of listeners) listener();
}

export function useClipUpload(recordingId: string): ClipUpload | null {
  return useSyncExternalStore(
    subscribe,
    () => uploads.get(recordingId) ?? null,
    () => null,
  );
}

/** Forgets an upload once its Clip is ready, or its block is gone. */
export function clearClipUpload(recordingId: string) {
  if (uploads.has(recordingId)) set(null, recordingId);
}

const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

type ChunkAnswer = { ok: true } | { ok: false; retry: boolean };

async function postChunk(url: string, body: Blob): Promise<ChunkAnswer> {
  try {
    // A body with no type and no headers keeps this a simple CORS request:
    // Clips' auth layer answers every preflight, and the ticket in the URL is
    // the only authority the request carries.
    const response = await fetch(url, {
      method: "POST",
      body,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (response.ok) return { ok: true };
    return {
      ok: false,
      retry: response.status === 429 || response.status >= 500,
    };
  } catch {
    return { ok: false, retry: true };
  }
}

/**
 * Sends a file to Clips in the ticket's chunks, in order, one at a time.
 * A chunk Clips couldn't take for a passing reason is sent again; any other
 * refusal ends the upload.
 */
export async function sendClipChunks(
  file: Blob,
  ticket: ClipUploadTicket,
  onSent: (sentBytes: number) => void,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (let index = 0; index < ticket.totalChunks; index += 1) {
    const start = index * ticket.chunkSizeBytes;
    const end = Math.min(file.size, start + ticket.chunkSizeBytes);
    const isFinal = index === ticket.totalChunks - 1;
    const url = new URL(ticket.chunkUrl);
    url.searchParams.set("index", String(index));
    url.searchParams.set("isFinal", isFinal ? "1" : "0");
    const body = file.slice(start, end, "");

    let answer = await postChunk(url.toString(), body);
    for (const delay of RETRY_DELAYS_MS) {
      if (answer.ok || !answer.retry) break;
      await wait(delay);
      answer = await postChunk(url.toString(), body);
    }
    if (!answer.ok) return false;
    onSent(end);
  }
  return true;
}

/** Sends a file to the Clip Clips made for it, showing progress in its block. */
export async function beginClipUpload(input: {
  file: File;
  ticket: ClipUploadTicket;
  documentId: string;
}) {
  const { file, ticket, documentId } = input;
  const base = {
    recordingId: ticket.recordingId,
    documentId,
    fileName: file.name,
  };
  set(
    { ...base, phase: "uploading", sentBytes: 0, totalBytes: file.size },
    ticket.recordingId,
  );
  const sent = await sendClipChunks(file, ticket, (sentBytes) => {
    if (uploads.get(ticket.recordingId)?.phase !== "uploading") return;
    set(
      { ...base, phase: "uploading", sentBytes, totalBytes: file.size },
      ticket.recordingId,
    );
  });
  if (!uploads.has(ticket.recordingId)) return;
  set({ ...base, phase: sent ? "making" : "failed" }, ticket.recordingId);
}

/**
 * Video files dropped or pasted into a page, waiting for the empty video
 * block made for each to start its upload. Only this tab has them.
 */
const droppedFiles = new Map<string, File>();

export function holdDroppedClipFile(uploadId: string, file: File) {
  droppedFiles.set(uploadId, file);
}

export function takeDroppedClipFile(uploadId: unknown): File | null {
  if (typeof uploadId !== "string") return null;
  const file = droppedFiles.get(uploadId) ?? null;
  droppedFiles.delete(uploadId);
  return file;
}
