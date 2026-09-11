import { appApiPath } from "@agent-native/core/client/api-path";

import {
  type BuilderIndexResult,
  readBuilderIndexResponse,
} from "./builder-index-response";

// GCS resumable uploads require every chunk except the last to be a multiple
// of 256 KiB. 16 MiB is the recommended default and keeps very large `.fig`
// files off a single request body (the serverless host caps bodies well below
// Figma export sizes).
const GCS_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 5;

interface UploadSlot {
  idx: number;
  uploadUrl: string;
  uploadToken: string;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function requestUploadSlots(files: File[]): Promise<UploadSlot[]> {
  const res = await fetch(appApiPath("/api/design-system-upload-start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attachments: files.map((file) => ({
        name: file.name,
        mimetype: file.type || "application/octet-stream",
        declaredSize: file.size,
      })),
    }),
  });
  const json = await readJson(res);
  if (!res.ok || json?.error) {
    throw new Error(json?.error || `Failed to start upload (${res.status})`);
  }
  const slots = Array.isArray(json?.uploads)
    ? ([...json.uploads] as UploadSlot[]).sort((a, b) => a.idx - b.idx)
    : [];
  if (slots.length !== files.length) {
    throw new Error("Upload could not be started for all files.");
  }
  return slots;
}

async function initiateResumableSession(
  uploadUrl: string,
  mimetype: string,
  fileSize: number,
): Promise<string> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-resumable": "start",
      // The signed URL commits to the exact declared size; echo it back
      // byte-for-byte or GCS rejects the session.
      "x-goog-content-length-range": `0,${fileSize}`,
      "Content-Type": mimetype,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to initiate upload session (${response.status})`);
  }
  const sessionUri = response.headers.get("Location");
  if (!sessionUri) {
    throw new Error("Upload session URI missing from storage response");
  }
  return sessionUri;
}

// GCS reports the highest committed byte in a `Range: bytes=0-<end>` header.
function committedOffsetFromRange(response: Response): number | null {
  const match = response.headers.get("Range")?.match(/bytes=0-(\d+)/);
  return match ? parseInt(match[1], 10) + 1 : null;
}

async function queryCommittedOffset(
  sessionUri: string,
  total: number,
): Promise<number> {
  const response = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
  });
  if (response.status === 200 || response.status === 201) return total;
  if (response.status === 308) return committedOffsetFromRange(response) ?? 0;
  throw new Error(`Failed to query upload status (${response.status})`);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function streamFileToStorage(
  slot: UploadSlot,
  file: File,
  onProgress: (uploadedBytes: number) => void,
): Promise<void> {
  const mimetype = file.type || "application/octet-stream";
  const sessionUri = await initiateResumableSession(
    slot.uploadUrl,
    mimetype,
    file.size,
  );
  const total = file.size;

  if (total === 0) {
    const response = await fetch(sessionUri, {
      method: "PUT",
      headers: { "Content-Range": "bytes */0" },
      body: new Uint8Array(0),
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(
        `Failed to finalize zero-byte upload (${response.status})`,
      );
    }
    onProgress(0);
    return;
  }

  let offset = 0;
  let retries = 0;
  while (offset < total) {
    const end = Math.min(offset + GCS_CHUNK_SIZE, total);
    const isLast = end === total;
    try {
      const response = await fetch(sessionUri, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end - 1}/${total}` },
        body: file.slice(offset, end),
      });
      if (response.status === 200 || response.status === 201) {
        offset = total;
      } else if (!isLast && response.status === 308) {
        const nextOffset = committedOffsetFromRange(response) ?? offset;
        if (nextOffset <= offset) {
          throw new Error(`Upload stalled at byte ${offset}`);
        }
        offset = nextOffset;
      } else {
        throw new Error(`Unexpected upload status ${response.status}`);
      }
      retries = 0;
      onProgress(offset);
    } catch (err) {
      if (++retries > MAX_CHUNK_RETRIES) throw err;
      await delay(500 * retries);
      try {
        offset = await queryCommittedOffset(sessionUri, total);
      } catch {
        // If the offset query also fails, retry from the last local offset —
        // GCS's resumable PUT safely re-acknowledges bytes it already has.
      }
      onProgress(offset);
    }
  }
}

export interface UploadAndIndexOptions {
  projectName?: string;
  onProgress?: (fraction: number) => void;
}

/**
 * Streams `.fig`/design files straight to storage in resumable chunks, then
 * finalizes Builder DSI indexing with the resulting upload tokens. No file
 * bytes pass through the app server, so arbitrarily large Figma files work.
 */
export async function uploadAndIndexFigmaFiles(
  files: File[],
  options: UploadAndIndexOptions = {},
): Promise<BuilderIndexResult> {
  if (files.length === 0) throw new Error("No files to upload.");

  const slots = await requestUploadSlots(files);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
  const uploadedPerFile = new Array<number>(files.length).fill(0);
  for (let i = 0; i < files.length; i++) {
    await streamFileToStorage(slots[i], files[i], (uploaded) => {
      uploadedPerFile[i] = uploaded;
      const done = uploadedPerFile.reduce((sum, n) => sum + n, 0);
      options.onProgress?.(Math.min(done / totalBytes, 1));
    });
  }

  const res = await fetch(appApiPath("/api/index-design-system-sources"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: options.projectName,
      uploadTokens: slots.map((slot) => slot.uploadToken),
    }),
  });
  return readBuilderIndexResponse(res);
}

export interface DecodeJobStatus {
  status: "pending" | "processing" | "complete" | "error";
  branchUrl: string | null;
  error: string | null;
  framesProcessed: number;
  totalFrames: number;
}

const DECODE_JOB_POLL_INTERVAL_MS = 5_000;
const DECODE_JOB_MAX_POLLS = 120; // ~10 min at 5s, so a stuck job can't loop forever

export interface PollDecodeJobOptions {
  signal?: AbortSignal;
  onUpdate?: (status: DecodeJobStatus) => void;
}

/**
 * After indexing returns a jobId, the `.fig` decode job is still `pending` with
 * no branchUrl. Poll until the branch appears or the job reaches a terminal
 * state. A job that reports `status: "error"` resolves so the caller can read
 * `status.error`; network failures, timeouts, and aborts reject.
 */
export async function pollDecodeJobStatus(
  jobId: string,
  options: PollDecodeJobOptions = {},
): Promise<DecodeJobStatus> {
  const { signal, onUpdate } = options;
  const path = appApiPath(
    `/api/design-system-decode-job-status?jobId=${encodeURIComponent(jobId)}`,
  );
  for (let i = 0; i < DECODE_JOB_MAX_POLLS; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await fetch(path, { signal });
    const json = await readJson(res);
    if (!res.ok || json?.error) {
      throw new Error(json?.error || `Status check failed (${res.status})`);
    }
    const status = json as DecodeJobStatus;
    onUpdate?.(status);
    if (
      status.branchUrl ||
      status.status === "complete" ||
      status.status === "error"
    ) {
      return status;
    }
    await delay(DECODE_JOB_POLL_INTERVAL_MS, signal);
  }
  throw new Error(
    "Timed out waiting for the design system to finish decoding.",
  );
}
