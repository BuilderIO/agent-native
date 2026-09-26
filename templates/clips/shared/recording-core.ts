
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

export type UploadMode = "streaming" | "buffered";

export const UPLOAD_SLICE_BYTES = 3 * 1024 * 1024;

export type UploadResponseFailureStage = "chunk_upload" | "reset_chunks";

export function classifyUploadResponseError(input: {
  contentType: string | null;
  body: string;
  status: number;
  stage: UploadResponseFailureStage;
}): {
  isHtml: boolean;
  responseText: string | null;
  status: number;
  failureCode: "upload_failed" | "chunk_html_error";
  failureStage: UploadResponseFailureStage;
} {
  const isHtml =
    /^\s*text\/html(?:\s*;|$)/i.test(input.contentType ?? "") ||
    /(?:<!doctype\s+html\b|<html\b)/i.test(input.body);

  return {
    isHtml,
    responseText: isHtml ? null : input.body,
    status: input.status,
    failureCode: isHtml ? "chunk_html_error" : "upload_failed",
    failureStage: input.stage,
  };
}

export function chunkUploadParallelism(
  uploadMode: UploadMode | undefined,
  bufferedParallelism: number,
): number {
  if (uploadMode === "streaming") return 1;
  return Math.max(1, Math.floor(bufferedParallelism));
}

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
  attemptId?: string;
  uploadGenerationId?: string;
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
  if (params.attemptId) q.set("attemptId", params.attemptId);
  if (params.uploadGenerationId) {
    q.set("uploadGenerationId", params.uploadGenerationId);
  }
  return q.toString();
}

export function chunkUploadUrl(
  chunkBaseUrl: string,
  params: ChunkUploadParams,
): string {
  const separator = chunkBaseUrl.includes("?") ? "&" : "?";
  return `${chunkBaseUrl}${separator}${chunkUploadQuery(params)}`;
}
