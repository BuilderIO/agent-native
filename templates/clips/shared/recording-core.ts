/**
 * Framework-agnostic recording primitives shared by BOTH recorders:
 *   - the web app recorder  (app/components/recorder/recorder-engine.ts)
 *   - the Chrome extension  (chrome-extension/src/offscreen.ts)
 *
 * Keep this free of React, chrome.*, Node-only APIs, and any DOM beyond the
 * media types (MediaRecorder, URLSearchParams) so both build targets — the
 * Vite app build and the extension's separate Vite build — can import it.
 *
 * The two recorders intentionally keep their own *orchestration* and *upload
 * strategy* (the extension streams each timeslice chunk from an offscreen
 * document that survives navigation; the web app assembles + slices on stop with
 * retry/compression). What MUST stay identical is the on-the-wire contract with
 * the server's chunk-upload route and the MediaRecorder codec choice — that's
 * what lives here.
 */

/** MediaRecorder codecs to try, best-supported first.
 *
 * vp8 is listed before vp9 because some display-capture streams report vp9
 * support but reject the encoder configuration; vp8 is the most broadly
 * accepted. MP4/avc1 is the Safari/WebKit fallback. */
export function pickMimeTypeCandidates(): string[] {
  return [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
}

/** First supported codec from {@link pickMimeTypeCandidates}, or "" to let the
 * browser pick its own default (callers should treat "" as "omit mimeType"). */
export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const type of pickMimeTypeCandidates()) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // isTypeSupported can throw on some builds — treat as unsupported.
    }
  }
  return "";
}

/** How the client delivers recorded data to the server.
 *  - `"streaming"` — chunks are flushed to GCS during recording via a resumable session
 *  - `"buffered"`  — full blob assembled after stop() and uploaded in slices */
export type UploadMode = "streaming" | "buffered";

/**
 * Resumable providers advance a single byte offset, so their chunks must be
 * sent in strict index order. Buffered uploads can retain bounded parallelism.
 */
export function chunkUploadParallelism(
  uploadMode: UploadMode | undefined,
  bufferedParallelism: number,
): number {
  if (uploadMode === "streaming") return 1;
  return Math.max(1, Math.floor(bufferedParallelism));
}

/** Query params understood by the chunk-upload route
 * (`/api/uploads/:id/chunk`). This is the on-the-wire contract — the route in
 * `server/routes/api/uploads/[recordingId]/chunk.post.ts` reads exactly these. */
export type ChunkUploadParams = {
  index: number;
  total?: number;
  isFinal?: boolean;
  mimeType?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  hasCamera?: boolean;
};

export function normalizeChunkUploadNumber(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined) return undefined;

  const numberValue =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : undefined;

  if (typeof numberValue !== "number" || !Number.isFinite(numberValue)) {
    return undefined;
  }
  return Math.max(0, Math.round(numberValue));
}

/** Encode {@link ChunkUploadParams} as the chunk-upload query string. Booleans
 * become `1`/`0` and `durationMs` is rounded — matching what the route parses. */
export function chunkUploadQuery(params: ChunkUploadParams): string {
  const q = new URLSearchParams();
  q.set("index", String(params.index));
  if (params.total !== undefined) q.set("total", String(params.total));
  q.set("isFinal", params.isFinal ? "1" : "0");
  if (params.mimeType) q.set("mimeType", params.mimeType);
  const durationMs = normalizeChunkUploadNumber(params.durationMs);
  const width = normalizeChunkUploadNumber(params.width);
  const height = normalizeChunkUploadNumber(params.height);
  if (durationMs !== undefined) q.set("durationMs", String(durationMs));
  if (width !== undefined) q.set("width", String(width));
  if (height !== undefined) q.set("height", String(height));
  if (params.hasAudio !== undefined) {
    q.set("hasAudio", params.hasAudio ? "1" : "0");
  }
  if (params.hasCamera !== undefined) {
    q.set("hasCamera", params.hasCamera ? "1" : "0");
  }
  return q.toString();
}

/** Full chunk-upload URL: `<chunkBaseUrl>?<encoded params>`. `chunkBaseUrl` is
 * the per-recording endpoint (e.g. `/api/uploads/<id>/chunk` or its absolute
 * form) with no existing query string. */
export function chunkUploadUrl(
  chunkBaseUrl: string,
  params: ChunkUploadParams,
): string {
  return `${chunkBaseUrl}?${chunkUploadQuery(params)}`;
}
