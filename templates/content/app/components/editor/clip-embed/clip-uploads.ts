import {
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import {
  CLIP_CANCEL_OUTCOME,
  CLIP_CHUNK_FINISHING,
  type ClipCancelResult,
  type ClipUploadTicket,
} from "@shared/clips-peer-contract";
import type { Editor } from "@tiptap/core";
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
  /** The page's Clip block for it. */
  blockId: string;
  fileName: string;
} & (
  | { phase: "uploading"; sentBytes: number; totalBytes: number }
  /**
   * Clips has every byte, and is making the Clip or waits for storage to be
   * connected first.
   */
  | { phase: "making" }
  | { phase: "failed" }
);

const uploads = new Map<string, ClipUpload>();
const listeners = new Set<() => void>();

/**
 * What this tab needs to give up an upload that isn't a Clip yet: one it is
 * still sending, or one whose last chunk Clips parked until storage is
 * connected.
 */
const tickets = new Map<
  string,
  { ticket: ClipUploadTicket; stop: AbortController }
>();

/**
 * Uploads whose block was missing from their page when last checked, with
 * the timer that gives each up. They live here, not with an editor, so
 * closing the page in that moment still gives the upload up.
 */
const goneTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopGoneTimer(recordingId: string) {
  clearTimeout(goneTimers.get(recordingId));
  goneTimers.delete(recordingId);
}

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
  if (upload) {
    uploads.set(recordingId, upload);
  } else {
    uploads.delete(recordingId);
    tickets.delete(recordingId);
    stopGoneTimer(recordingId);
  }

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

/** Marks an upload failed once Clips says it couldn't make the Clip. */
export function failClipUpload(recordingId: string) {
  const upload = uploads.get(recordingId);
  if (!upload || upload.phase === "failed") return;
  const { documentId, blockId, fileName } = upload;
  set(
    { recordingId, documentId, blockId, fileName, phase: "failed" },
    recordingId,
  );
}

const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

/**
 * How long one chunk may go unanswered before it counts as a passing failure.
 * A 3 MiB chunk takes about 30 s at 0.8 Mbps, and this is past Clips' 75 s
 * function limit too, so a chunk sent again never runs beside the first.
 */
const CLIP_CHUNK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * How long a final chunk keeps going while Clips is still taking an earlier
 * send of it: a little longer than Clips' claim on the upload
 * (`FINAL_CHUNK_CLAIM_TTL_MS`, 2 minutes), after which the claim expires.
 */
const CLIP_FINISHING_WAIT_MS = 150_000;
const FINISHING_RETRY_MS = 5_000;

/**
 * How long to wait before each repeat of a cancel Clips can't decide yet, or
 * didn't answer.
 */
const CANCEL_RETRY_MS = [2_000, 5_000, 10_000];

/**
 * How long one cancel may go unanswered before it counts as unconfirmed. It
 * carries no body, and Clips answers once its abort has run, in seconds.
 */
const CLIP_CANCEL_TIMEOUT_MS = 20_000;

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type ChunkAnswer =
  /** `parked`: Clips took the file, and waits for storage to make the Clip. */
  | { ok: true; parked: boolean }
  | { ok: false; retry: boolean }
  /** Clips is still taking an earlier send of this final chunk. */
  | { ok: false; finishing: true };

/**
 * Whether the chunk Clips took parked the upload until storage is connected.
 * An answer this can't read counts as parked: the ticket is kept, and a
 * cancel of an upload Clips is making changes nothing.
 */
async function parkedBy(response: Response): Promise<boolean> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) return true;
    throw error;
  }
  if (typeof body !== "object" || body === null) return true;
  return (body as { waitingForStorage?: unknown }).waitingForStorage === true;
}

/**
 * Why Clips refused a final chunk it already has: `finished` when it took an
 * earlier send whose answer was lost, `finishing` while it is still taking
 * one.
 */
async function finalChunkConflict(
  response: Response,
): Promise<"finished" | "finishing" | null> {
  if (response.status !== 409) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const { outcome, data } = (body ?? {}) as {
    outcome?: unknown;
    data?: { status?: unknown };
  };
  if (outcome === CLIP_CHUNK_FINISHING) return "finishing";
  return data?.status === "processing" || data?.status === "ready"
    ? "finished"
    : null;
}

async function postChunk(
  url: string,
  body: Blob,
  signal?: AbortSignal,
): Promise<ChunkAnswer> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLIP_CHUNK_TIMEOUT_MS);
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
      signal: signal
        ? AbortSignal.any([signal, timeout.signal])
        : timeout.signal,
    });
    if (response.ok) return { ok: true, parked: await parkedBy(response) };
    const conflict = await finalChunkConflict(response);
    if (conflict === "finished") return { ok: true, parked: false };
    if (conflict === "finishing") return { ok: false, finishing: true };
    return {
      ok: false,
      retry: response.status === 429 || response.status >= 500,
    };
  } catch {
    return { ok: false, retry: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a file to Clips in the ticket's chunks, in order, one at a time.
 * A chunk Clips couldn't take for a passing reason, or didn't answer in
 * time, is sent again, as is a final chunk Clips is still taking an earlier
 * send of; any other refusal, or `signal` aborting, ends the upload. Once
 * Clips has it all, `parked` says it waits for storage before it makes the
 * Clip.
 */
export async function sendClipChunks(
  file: Blob,
  ticket: ClipUploadTicket,
  onSent: (sentBytes: number) => void,
  wait: (ms: number) => Promise<void> = pause,
  signal?: AbortSignal,
): Promise<"failed" | "making" | "parked"> {
  let parked = false;
  for (let index = 0; index < ticket.totalChunks; index += 1) {
    const start = index * ticket.chunkSizeBytes;
    const end = Math.min(file.size, start + ticket.chunkSizeBytes);
    const isFinal = index === ticket.totalChunks - 1;
    const url = new URL(ticket.chunkUrl);
    url.searchParams.set("index", String(index));
    url.searchParams.set("isFinal", isFinal ? "1" : "0");
    const body = file.slice(start, end, "");

    let answer = await postChunk(url.toString(), body, signal);
    const retryDelays = RETRY_DELAYS_MS.values();
    let finishingFor = 0;
    while (!answer.ok && !signal?.aborted) {
      if ("finishing" in answer) {
        if (finishingFor >= CLIP_FINISHING_WAIT_MS) break;
        finishingFor += FINISHING_RETRY_MS;
        await wait(FINISHING_RETRY_MS);
      } else {
        const delay = retryDelays.next();
        if (!answer.retry || delay.done) break;
        await wait(delay.value);
      }
      if (signal?.aborted) break;
      answer = await postChunk(url.toString(), body, signal);
    }
    if (!answer.ok || signal?.aborted) return "failed";
    parked = answer.parked;
    onSent(end);
  }
  return parked ? "parked" : "making";
}

type CancelAnswer =
  | ClipCancelResult
  /** Clips can't say yet, or didn't answer: the same cancel can go again. */
  | { outcome: typeof CLIP_CANCEL_OUTCOME.finishing | "unanswered" };

function settled(answer: CancelAnswer): answer is ClipCancelResult {
  return (
    answer.outcome !== CLIP_CANCEL_OUTCOME.finishing &&
    answer.outcome !== "unanswered"
  );
}

function cancelResult(httpStatus: number, text: string): CancelAnswer | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const { outcome, status } = (body ?? {}) as {
    outcome?: unknown;
    status?: unknown;
  };
  if (httpStatus === 200 && outcome === CLIP_CANCEL_OUTCOME.cancelled) {
    return { outcome };
  }
  if (
    httpStatus === 409 &&
    outcome === CLIP_CANCEL_OUTCOME.alreadyFinished &&
    (status === "processing" || status === "ready")
  ) {
    return { outcome, status };
  }
  if (httpStatus === 409 && outcome === CLIP_CANCEL_OUTCOME.finishing) {
    return { outcome };
  }
  return null;
}

async function sendCancel(ticket: ClipUploadTicket): Promise<CancelAnswer> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLIP_CANCEL_TIMEOUT_MS);
  try {
    // No body and no headers, like a chunk: a simple CORS request whose
    // ticket is its only authority. `keepalive` outlives the page.
    const response = await fetch(ticket.cancelUrl, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      keepalive: true,
      signal: timeout.signal,
    });
    const result = cancelResult(response.status, await response.text());
    if (result) return result;
    console.warn("[content-clips] Clips refused an upload's cancel", {
      recordingId: ticket.recordingId,
      status: response.status,
    });
    return { outcome: "not_cancelled" };
  } catch (error) {
    console.warn("[content-clips] an upload's cancel didn't reach Clips", {
      recordingId: ticket.recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: "unanswered" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells Clips this tab gave an upload up, so the Clip fails and its free clip
 * comes back now, not when Clips' cleanup finds it an hour later. Clips may
 * have had the whole file first and kept the Clip. While Clips is taking the
 * final chunk it can't say yet, and a cancel it didn't answer may not have
 * reached it, so the same cancel goes again a few times; `not_cancelled`
 * means Clips confirmed neither, and that cleanup still gets there.
 */
export async function cancelClipUpload(
  ticket: ClipUploadTicket,
  wait: (ms: number) => Promise<void> = pause,
): Promise<ClipCancelResult> {
  let answer = await sendCancel(ticket);
  for (const delay of CANCEL_RETRY_MS) {
    if (settled(answer)) break;
    await wait(delay);
    answer = await sendCancel(ticket);
  }
  if (settled(answer)) return answer;
  console.warn("[content-clips] Clips didn't settle an upload's cancel", {
    recordingId: ticket.recordingId,
    outcome: answer.outcome,
  });
  return { outcome: "not_cancelled" };
}

/**
 * Stops sending an upload this tab gave up, and cancels it in Clips. Null
 * when this tab holds no ticket for it.
 */
export function giveUpClipUpload(
  recordingId: string,
): Promise<ClipCancelResult> | null {
  const entry = tickets.get(recordingId);
  if (!entry) return null;
  tickets.delete(recordingId);
  entry.stop.abort();
  clearClipUpload(recordingId);
  return cancelClipUpload(entry.ticket);
}

/** Sends a file to the Clip Clips made for it, showing progress in its block. */
export async function beginClipUpload(input: {
  file: File;
  ticket: ClipUploadTicket;
  documentId: string;
  /** The page's Clip block for it, which the upload ends with. */
  blockId: string;
}) {
  const { file, ticket, documentId, blockId } = input;
  const { recordingId } = ticket;
  const base = { recordingId, documentId, blockId, fileName: file.name };
  const stop = new AbortController();
  tickets.set(recordingId, { ticket, stop });
  set(
    { ...base, phase: "uploading", sentBytes: 0, totalBytes: file.size },
    recordingId,
  );
  const sent = await sendClipChunks(
    file,
    ticket,
    (sentBytes) => {
      if (uploads.get(recordingId)?.phase !== "uploading") return;
      set(
        { ...base, phase: "uploading", sentBytes, totalBytes: file.size },
        recordingId,
      );
    },
    undefined,
    stop.signal,
  );
  // A parked upload isn't a Clip yet, so its block going still gives it up.
  if (tickets.get(recordingId)?.stop === stop && sent !== "parked") {
    tickets.delete(recordingId);
  }
  // Whatever gave the upload up while it was sending also cancelled it.
  if (stop.signal.aborted || !uploads.has(recordingId)) return;
  if (sent !== "failed") {
    set({ ...base, phase: "making" }, recordingId);
    forgetIfUnshown(recordingId);
    return;
  }
  // Clips would wait an hour for the rest. It can also have had the whole
  // file already, when only the last chunk's answer was lost.
  const cancelled = await cancelClipUpload(ticket);
  if (!uploads.has(recordingId)) return;
  const finished = cancelled.outcome === CLIP_CANCEL_OUTCOME.alreadyFinished;
  set({ ...base, phase: finished ? "making" : "failed" }, recordingId);
  forgetIfUnshown(recordingId);
}

/** How long an upload's block may be gone before the upload is forgotten. */
export const CLIP_UPLOAD_BLOCK_GONE_MS = 5_000;

type ClipUploadEditor = Pick<Editor, "on" | "off" | "state" | "isDestroyed">;

/** The editors open on each page in this tab. */
const pageEditors = new Map<string, Set<ClipUploadEditor>>();

/**
 * Forgets an upload this tab isn't sending once no editor has its page open,
 * with any ticket kept for a parked one: nothing shows it, and reopening the
 * page learns from Clips how the Clip is doing. One whose block just went is
 * left to its timer.
 */
function forgetIfUnshown(recordingId: string) {
  const upload = uploads.get(recordingId);
  if (
    upload &&
    upload.phase !== "uploading" &&
    !pageEditors.has(upload.documentId) &&
    !goneTimers.has(recordingId)
  ) {
    clearClipUpload(recordingId);
  }
}

function registryBlockIds(editor: ClipUploadEditor): Set<string> {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "registryBlock") return true;
    if (typeof node.attrs.blockId === "string") ids.add(node.attrs.blockId);
    return false;
  });
  return ids;
}

function onPage(documentId: string, blockId: string): boolean {
  for (const editor of pageEditors.get(documentId) ?? []) {
    if (!editor.isDestroyed && registryBlockIds(editor).has(blockId)) {
      return true;
    }
  }
  return false;
}

function stillGone(
  recordingId: string,
  onGivenUp: (upload: ClipUpload, cancelled: ClipCancelResult) => void,
) {
  goneTimers.delete(recordingId);
  const upload = uploads.get(recordingId);
  // A merge from outside the editor puts a block back without an update.
  if (!upload || onPage(upload.documentId, upload.blockId)) return;
  const cancelling = giveUpClipUpload(recordingId);
  if (cancelling) {
    void cancelling.then((cancelled) => onGivenUp(upload, cancelled));
  } else {
    clearClipUpload(recordingId);
  }
}

/**
 * Forgets each of this page's uploads once its block has been gone from the
 * page for a moment, long enough for a cut and paste or an undo to bring it
 * back. One this tab is still sending, or Clips parked, is given up too, and
 * `onGivenUp` gets what its cancel did. That moment runs on after the editor
 * closes; once the page's last editor closes, an upload whose block is on
 * the page keeps sending while the tab is open and is forgotten when its
 * sending ends, and the rest are forgotten at once.
 * Checks the page at once, so start it once the page's content is in.
 */
export function watchClipUploadBlocks(
  editor: ClipUploadEditor,
  documentId: string,
  onGivenUp: (upload: ClipUpload, cancelled: ClipCancelResult) => void,
): () => void {
  function check() {
    const mine = [...uploads.values()].filter(
      (upload) => upload.documentId === documentId,
    );
    if (mine.length === 0) return;
    const present = registryBlockIds(editor);
    for (const { recordingId, blockId } of mine) {
      if (present.has(blockId)) {
        stopGoneTimer(recordingId);
      } else if (!goneTimers.has(recordingId)) {
        goneTimers.set(
          recordingId,
          setTimeout(
            () => stillGone(recordingId, onGivenUp),
            CLIP_UPLOAD_BLOCK_GONE_MS,
          ),
        );
      }
    }
  }
  const editors = pageEditors.get(documentId) ?? new Set<ClipUploadEditor>();
  editors.add(editor);
  pageEditors.set(documentId, editors);
  check();
  editor.on("update", check);
  return () => {
    editor.off("update", check);
    editors.delete(editor);
    if (editors.size > 0) return;
    pageEditors.delete(documentId);
    for (const upload of [...uploads.values()]) {
      if (upload.documentId === documentId) {
        forgetIfUnshown(upload.recordingId);
      }
    }
  };
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
