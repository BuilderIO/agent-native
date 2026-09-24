/**
 * Decode a `.fig` in the browser and save its frames in batches.
 *
 * The server route exists because the decoder used to be Node-only. It is not
 * any more (`shared/fig-bytes.ts`), and decoding here removes the upload
 * entirely: a Netlify function request is capped at ~6MB while real `.fig`
 * files run to tens of megabytes, which is why the server route has to chunk.
 * Nothing large crosses the network on this path — embedded images go up one
 * at a time through `upload-image`, and frames go up a few megabytes at a time.
 * The individual image budget keeps base64 action requests under the
 * serverless transport cap while the `.fig` container itself can exceed the
 * old 50 MB server upload ceiling up to a finite browser safety limit.
 *
 * Decode and render run in a Worker (`fig-import-worker.ts`): on a
 * 60k-layer file they are seconds of CPU that used to freeze the editor.
 *
 * The server route stays for callers that are not a browser (the agent, A2A,
 * the fidelity harness) and as the fallback when decoding here fails.
 */

import { callAction, getBrowserTabId } from "@agent-native/core/client/hooks";

import { bytesToBase64, utf8ByteLength } from "../../shared/fig-bytes.js";
import {
  completeFigImport,
  MAX_FIG_FRAME_HTML_BYTES,
  shouldWarnForFigImport,
  type FigFileImportResult,
  type FigImportSummary,
} from "../../shared/fig-to-frames.js";
import type { ImportResult } from "./design-import";
import type {
  FigImportWorkerRequest,
  FigImportWorkerResponse,
} from "./fig-import-worker";
import {
  assertBrowserFigSize,
  createFigImportSession,
  MAX_CLIENT_FIG_BYTES,
  MAX_CLIENT_IMAGE_BYTES,
  type RenderedBrowserFigImport,
} from "./fig-import-worker-session";

export { MAX_CLIENT_FIG_BYTES, MAX_CLIENT_IMAGE_BYTES, shouldWarnForFigImport };

/** A save request stays well under the 4 MB action body budget. */
const MAX_SAVE_BATCH_BYTES = 3 * 1024 * 1024;
const MAX_SAVE_BATCH_FRAMES = 32;

export interface FigClientImportProgress {
  phase: "decoding" | "rendering" | "images" | "saving";
  /** 0-1 within the current phase, when it is countable. */
  ratio?: number;
  /** `saving` only: frames the server has confirmed, of `total`. */
  saved?: number;
  total?: number;
}

export interface FigClientImportOptions {
  designId: string;
  file: File;
  prepared?: PreparedFigImport;
  selection?: ReadonlySet<string>;
  onProgress?: (progress: FigClientImportProgress) => void;
}

export class FigClientImportError extends Error {
  constructor(
    message: string,
    readonly remoteMutationStarted: boolean,
  ) {
    super(message);
    this.name = "FigClientImportError";
  }
}

/** A decoded `.fig` waiting for its frame selection. */
export interface PreparedFigImport {
  file: File;
  summary: FigImportSummary;
  render(selection?: ReadonlySet<string>): Promise<RenderedBrowserFigImport>;
  /** Frees the decoded document. Call it when the import ends or is cancelled. */
  dispose(): void;
}

type FigImportWorker = Omit<PreparedFigImport, "file" | "summary"> & {
  prepare(file: File): Promise<FigImportSummary>;
};

function startFigImportWorker(): FigImportWorker {
  if (typeof Worker === "undefined") {
    const session = createFigImportSession();
    return {
      prepare: (file) => session.prepare(file),
      render: async (selection) => session.render(selection),
      dispose: () => {},
    };
  }
  const worker = new Worker(
    new URL("./fig-import-worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;
  let stopped: Error | null = null;
  const stop = (error: Error) => {
    stopped ??= error;
    worker.terminate();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<FigImportWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    stop(
      new Error(
        `The .fig import worker failed: ${event.message || "it could not start"}.`,
      ),
    );
  };
  worker.onmessageerror = () =>
    stop(
      new Error("The .fig import worker sent a result that could not be read."),
    );
  const call = <T>(
    request:
      | Omit<Extract<FigImportWorkerRequest, { type: "prepare" }>, "id">
      | Omit<Extract<FigImportWorkerRequest, { type: "render" }>, "id">,
  ) =>
    new Promise<T>((resolve, reject) => {
      if (stopped) {
        reject(stopped);
        return;
      }
      const id = nextId++;
      pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      worker.postMessage({ ...request, id });
    });
  return {
    prepare: (file) => call<FigImportSummary>({ type: "prepare", file }),
    render: (selection) =>
      call<RenderedBrowserFigImport>({ type: "render", selection }),
    dispose: () => stop(new Error("The .fig import was cancelled.")),
  };
}

function browserImportId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `fig-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

async function callWithOneRetry<T>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  // The importing tab ignores its own change events; finishImport refetches
  // once at the end instead of once per request.
  const options = { headers: { "X-Request-Source": getBrowserTabId() } };
  try {
    return (await callAction(action, input, options)) as T;
  } catch (firstError) {
    try {
      return (await callAction(action, input, options)) as T;
    } catch {
      throw firstError;
    }
  }
}

function packSaveBatches<T>(frames: T[]): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let batchBytes = 0;
  for (const frame of frames) {
    const frameBytes = utf8ByteLength(JSON.stringify(frame));
    if (
      batch.length > 0 &&
      (batch.length === MAX_SAVE_BATCH_FRAMES ||
        batchBytes + frameBytes > MAX_SAVE_BATCH_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(frame);
    batchBytes += frameBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * Frame positions relative to the selection's top-left, when every frame has
 * one. Each Figma page has its own coordinate space, so frames from different
 * pages would land on top of each other; those go without positions and the
 * server lays them out in a row.
 */
function relativeFramePositions({
  frames,
  pageCount,
}: RenderedBrowserFigImport): Array<{ frameX: number; frameY: number }> | null {
  if (
    pageCount > 1 ||
    !frames.every(
      (frame) => Number.isFinite(frame.x) && Number.isFinite(frame.y),
    )
  ) {
    return null;
  }
  const minX = Math.min(...frames.map((frame) => frame.x!));
  const minY = Math.min(...frames.map((frame) => frame.y!));
  return frames.map((frame) => ({
    frameX: frame.x! - minX,
    frameY: frame.y! - minY,
  }));
}

/**
 * Render in the worker, upload the embedded images one request each, then
 * save the frames in batches. Returns the same shape the server route returns
 * so the caller's success and warning handling is unchanged.
 */
export async function importFigInBrowser(
  options: FigClientImportOptions,
): Promise<ImportResult> {
  const { designId, file, onProgress, selection } = options;
  assertBrowserFigSize(file);
  const prepared =
    options.prepared ?? (await prepareFigImport(file, onProgress));
  let rendered: RenderedBrowserFigImport;
  try {
    onProgress?.({ phase: "rendering" });
    rendered = await prepared.render(selection);
  } finally {
    prepared.dispose();
  }

  let remoteMutationStarted = false;
  let uploaded = 0;
  const total = rendered.images.length;
  const importId = browserImportId();
  let converted: FigFileImportResult;
  try {
    converted = await completeFigImport(rendered, {
      originalName: file.name,
      // The upload action resolves the owner from the session; this value is only
      // read by the server-side uploader this path replaces.
      ownerEmail: "",
      // The action wraps the document; nothing to do here.
      normalizeHtml: (content: string) => content,
      maxFrameHtmlBytes: MAX_FIG_FRAME_HTML_BYTES,
      uploader: async ({ data, filename, mimeType }) => {
        remoteMutationStarted = true;
        const idempotencyKey = `${importId}:${filename}`;
        const url = await callWithOneRetry<{ url?: string }>("upload-image", {
          data: `data:${mimeType};base64,${bytesToBase64(data)}`,
          filename,
          idempotencyKey,
        });
        uploaded += 1;
        onProgress?.({
          phase: "images",
          ratio: total ? uploaded / total : 1,
        });
        // A null result means storage is unavailable; the converter rejects the
        // import rather than persisting frames with missing images.
        if (!url?.url) return null;
        return {
          url: url.url,
          cleanup: async () => {
            const result = await callWithOneRetry<{
              alreadyMissing?: boolean;
              committed?: boolean;
              deleted?: boolean;
            }>("upload-image", { idempotencyKey, cleanup: "delete" });
            return (
              result.deleted === true ||
              result.alreadyMissing === true ||
              result.committed === true
            );
          },
          finalize: async () => {
            const result = await callWithOneRetry<{
              alreadyMissing?: boolean;
              released?: boolean;
            }>("upload-image", { idempotencyKey, cleanup: "release" });
            return result.released === true || result.alreadyMissing === true;
          },
        };
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FigClientImportError(message, remoteMutationStarted);
  }

  const positions = relativeFramePositions(rendered);
  const frames = converted.files.map((frame, index) => ({
    content: frame.content,
    originalName: frame.filename,
    frameTitle: frame.preferredFrame?.title,
    frameWidth: frame.preferredFrame?.width,
    frameHeight: frame.preferredFrame?.height,
    ...positions?.[index],
    clientImportId: `${importId}:frame:${index}`,
  }));
  const batches = packSaveBatches(frames);
  const saved: ImportResult & { files: NonNullable<ImportResult["files"]> } = {
    files: [],
    warnings: converted.warnings,
    skippedEmbeddedImageCount: rendered.skippedEmbeddedImageCount || undefined,
  };
  let sentFrames = 0;
  try {
    onProgress?.({ phase: "saving", ratio: 0, saved: 0, total: frames.length });
    for (const [batchIndex, batch] of batches.entries()) {
      // Do not fall back after this point: the action may have committed even
      // if the browser lost its response.
      remoteMutationStarted = true;
      sentFrames += batch.length;
      const result = await callWithOneRetry<ImportResult>(
        "import-design-source",
        {
          designId,
          sourceType: "fig-frame",
          frames: batch,
          clientImportBatchId: importId,
          clientImportFinalBatch: batchIndex === batches.length - 1,
        },
      );
      if (result.error) throw new Error(result.error);
      if (result.files?.length !== batch.length) {
        throw new Error(
          `The server confirmed ${result.files?.length ?? 0} of ${batch.length} frames in a save batch.`,
        );
      }
      saved.designId = result.designId ?? saved.designId;
      saved.files.push(...result.files);
      onProgress?.({
        phase: "saving",
        ratio: saved.files.length / frames.length,
        saved: saved.files.length,
        total: frames.length,
      });
    }
  } catch (error) {
    // One call removes every frame of this import, including any the server
    // committed after the browser lost its response.
    let framesCleanupFailed = false;
    try {
      const aborted = await callWithOneRetry<{ deletedFileIds?: unknown }>(
        "import-design-source",
        {
          designId,
          sourceType: "fig-frame",
          clientImportBatchId: importId,
          abort: true,
        },
      );
      framesCleanupFailed = !Array.isArray(aborted?.deletedFileIds);
    } catch {
      framesCleanupFailed = true;
    }
    const imageCleanupFailures = (await converted.cleanup?.()) ?? 0;
    const message = error instanceof Error ? error.message : String(error);
    const cleanupMessage = [
      framesCleanupFailed
        ? `Cleanup failed for ${sentFrames} partially imported screen${sentFrames === 1 ? "" : "s"}.`
        : "",
      imageCleanupFailures > 0
        ? `Storage cleanup failed for ${imageCleanupFailures} uploaded image${imageCleanupFailures === 1 ? "" : "s"}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw new FigClientImportError(
      cleanupMessage ? `${message} ${cleanupMessage}` : message,
      remoteMutationStarted,
    );
  }
  // Receipt release is best-effort after all frames are saved. A partial
  // release must not roll back valid frames; the server-side receipt sweep
  // expires abandoned staged receipts.
  await converted.finalize?.();
  return {
    ...saved,
    unresolvedImageRefCount: converted.stats.unresolvedImageRefCount,
  };
}

export async function prepareFigImport(
  file: File,
  onProgress?: (progress: FigClientImportProgress) => void,
): Promise<PreparedFigImport> {
  assertBrowserFigSize(file);
  onProgress?.({ phase: "decoding" });
  const worker = startFigImportWorker();
  try {
    return { file, summary: await worker.prepare(file), ...worker };
  } catch (error) {
    worker.dispose();
    throw error;
  }
}
