import { appStateGet } from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  getSession,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { getRequestURL, setResponseHeader, type H3Event } from "h3";
import {
  buildAgentApiUrls,
  buildRecommendedFrames,
  CLIP_AGENT_CONTEXT_VERSION,
  toAgentTranscriptSegments,
} from "../../shared/agent-context.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../../shared/transcript-segments.js";
import {
  parseBrowserDiagnosticsRow,
  type BrowserDiagnosticsData,
} from "../../shared/browser-diagnostics.js";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom.js";
import { getDb, schema } from "../db/index.js";
import { verifySharePassword } from "./share-password.js";

export type PublicAgentRecording = typeof schema.recordings._.inferSelect;
export type PublicAgentTranscript =
  | typeof schema.recordingTranscripts._.inferSelect
  | null;

export interface PublicAgentAccess {
  recording: PublicAgentRecording;
  viewerIsOwner: boolean;
  apiToken: string | null;
}

export interface PublicAgentFailure {
  status: number;
  body: Record<string, unknown>;
}

export type PublicAgentAccessResult =
  | { ok: true; access: PublicAgentAccess }
  | { ok: false; failure: PublicAgentFailure };

const DEFAULT_MAX_AGENT_FRAME_MEDIA_BYTES = 200 * 1024 * 1024;

export class RecordingMediaFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "RecordingMediaFetchError";
  }
}

export function getServerAppBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}` : "";
}

export function applyAgentJsonHeaders(event: H3Event) {
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
}

export function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function maxAgentFrameMediaBytes(): number {
  const configured = Number(process.env.CLIPS_AGENT_FRAME_MAX_MEDIA_BYTES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  return DEFAULT_MAX_AGENT_FRAME_MEDIA_BYTES;
}

function frameMediaTooLargeMessage(size: number, maxBytes: number) {
  return `Recording media is too large for on-demand frame extraction (${size} bytes, max ${maxBytes}).`;
}

function assertFrameMediaSize(size: number | null | undefined) {
  if (!Number.isFinite(size ?? NaN) || (size ?? 0) <= 0) return;
  const maxBytes = maxAgentFrameMediaBytes();
  if ((size ?? 0) > maxBytes) {
    throw new Error(frameMediaTooLargeMessage(size ?? 0, maxBytes));
  }
}

function normalizeBase64Payload(value: string): string {
  return value
    .trim()
    .replace(/^data:[^,]*;base64,/i, "")
    .replace(/\s/g, "");
}

function estimateBase64DecodedByteLength(value: string): number {
  const normalized = normalizeBase64Payload(value);
  if (!normalized) return 0;
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function readResponseBytesWithLimit(
  response: Response,
): Promise<Uint8Array> {
  const maxBytes = maxAgentFrameMediaBytes();
  const contentLength = Number(response.headers.get("content-length"));
  assertFrameMediaSize(contentLength);

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    assertFrameMediaSize(arrayBuffer.byteLength);
    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(frameMediaTooLargeMessage(totalBytes, maxBytes));
      }

      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, totalBytes);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export async function loadPublicAgentAccess(
  event: H3Event,
  recordingId: string,
  options: { password?: string; token?: string } = {},
): Promise<PublicAgentAccessResult> {
  const id = recordingId.trim();
  if (!id) {
    return {
      ok: false,
      failure: { status: 400, body: { error: "id is required" } },
    };
  }

  const db = getDb();
  const [recording] = await db
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .limit(1);

  if (!recording) {
    return {
      ok: false,
      failure: { status: 404, body: { error: "Not found" } },
    };
  }

  if (recording.trashedAt || recording.archivedAt) {
    return {
      ok: false,
      failure: { status: 404, body: { error: "Not found" } },
    };
  }

  const session = await getSession(event).catch(() => null);
  const viewerIsOwner = Boolean(
    session?.email && session.email === recording.ownerEmail,
  );

  if (recording.visibility !== "public" && !viewerIsOwner) {
    return {
      ok: false,
      failure: { status: 404, body: { error: "Not found" } },
    };
  }

  if (recording.expiresAt) {
    const expires = new Date(recording.expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) {
      return {
        ok: false,
        failure: {
          status: 410,
          body: { error: "Recording has expired", expired: true },
        },
      };
    }
  }

  let apiToken: string | null = null;
  if (
    recording.password &&
    recording.visibility === "public" &&
    viewerIsOwner
  ) {
    apiToken = signShortLivedToken({ resourceId: recording.id });
  }

  if (recording.password && !viewerIsOwner) {
    const suppliedToken = options.token ?? "";
    const suppliedPassword = options.password ?? "";
    let allowed = false;

    if (suppliedToken) {
      const result = verifyShortLivedToken(suppliedToken, recording.id);
      if (result.ok) {
        allowed = true;
        apiToken = suppliedToken;
      }
    }

    if (
      !allowed &&
      suppliedPassword &&
      verifySharePassword(suppliedPassword, recording.password)
    ) {
      allowed = true;
      apiToken = signShortLivedToken({ resourceId: recording.id });
    }

    if (!allowed) {
      return {
        ok: false,
        failure: {
          status: 401,
          body: { error: "Password required", passwordRequired: true },
        },
      };
    }
  }

  return {
    ok: true,
    access: {
      recording,
      viewerIsOwner,
      apiToken,
    },
  };
}

export async function loadAgentTranscript(
  recordingId: string,
  durationMs: number,
) {
  const [transcript] = await getDb()
    .select()
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);

  const normalized = normalizeTranscriptSegments({
    segments: parseTranscriptSegments(transcript?.segmentsJson),
    fullText: transcript?.fullText,
    durationMs,
  });

  return {
    transcript: transcript ?? null,
    segments: normalized,
    agentSegments: toAgentTranscriptSegments(normalized),
  };
}

export function parseAgentChapters(recording: PublicAgentRecording) {
  try {
    const parsed = JSON.parse(recording.chaptersJson ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((chapter) => ({
        startMs: Number(chapter?.startMs),
        title: typeof chapter?.title === "string" ? chapter.title.trim() : "",
      }))
      .filter(
        (chapter) =>
          Number.isFinite(chapter.startMs) &&
          chapter.startMs >= 0 &&
          chapter.title,
      );
  } catch {
    return [];
  }
}

export async function loadAgentCtas(recordingId: string) {
  return await getDb()
    .select()
    .from(schema.recordingCtas)
    .where(eq(schema.recordingCtas.recordingId, recordingId))
    .orderBy(asc(schema.recordingCtas.createdAt));
}

export async function loadAgentBrowserDiagnostics(recordingId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.recordingBrowserDiagnostics)
    .where(eq(schema.recordingBrowserDiagnostics.recordingId, recordingId))
    .limit(1);
  return parseBrowserDiagnosticsRow(row);
}

function compactBrowserDiagnostics(diagnostics: BrowserDiagnosticsData | null) {
  if (!diagnostics) return null;
  const consoleIssues = diagnostics.consoleLogs
    .filter((entry) => entry.level === "warn" || entry.level === "error")
    .slice(-20)
    .map((entry) => ({
      timestampMs: entry.elapsedMs,
      level: entry.level,
      message: entry.message,
    }));
  const failedNetworkRequests = diagnostics.networkRequests
    .filter(
      (entry) =>
        Boolean(entry.error) ||
        (typeof entry.status === "number" && entry.status >= 400),
    )
    .slice(-20)
    .map((entry) => ({
      timestampMs: entry.elapsedMs,
      type: entry.type,
      method: entry.method,
      status: entry.status ?? null,
      error: entry.error ?? null,
      durationMs: entry.durationMs,
    }));
  return {
    summary: diagnostics.summary,
    consoleIssues,
    failedNetworkRequests,
    note: "Diagnostics are redacted and bounded; public context omits page URLs, request URLs, headers, bodies, cookies, and query values.",
  };
}

export function buildPublicAgentContext({
  event,
  access,
  transcript,
  agentSegments,
  chapters,
  ctas,
  browserDiagnostics,
}: {
  event: H3Event;
  access: PublicAgentAccess;
  transcript: PublicAgentTranscript;
  agentSegments: ReturnType<typeof toAgentTranscriptSegments>;
  chapters: ReturnType<typeof parseAgentChapters>;
  ctas: Awaited<ReturnType<typeof loadAgentCtas>>;
  browserDiagnostics?: BrowserDiagnosticsData | null;
}) {
  const recording = access.recording;
  const requestUrl = getRequestURL(event);
  const api = buildAgentApiUrls(recording.id, {
    origin: requestUrl.origin,
    basePath: getServerAppBasePath(),
    token: access.apiToken,
  });
  const publicPageUrl = `${requestUrl.origin}${getServerAppBasePath()}/share/${encodeURIComponent(recording.id)}`;
  const isLoomSource = isLoomRecordingSource(recording);
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const suggestedFrames = isLoomEmbedBacked
    ? []
    : buildRecommendedFrames({
        durationMs: recording.durationMs,
        chapters,
        segments: agentSegments,
      }).map((frame) => ({
        ...frame,
        url: api.frameUrl(frame.atMs),
      }));
  const instructions = [
    "Use transcript.segments for timestamped spoken context.",
    ...(browserDiagnostics
      ? [
          "Use browserDiagnostics for redacted console warnings/errors and failed network requests captured during the recording.",
        ]
      : []),
    ...(isLoomEmbedBacked
      ? [
          "This clip is a legacy Loom embed import; frame extraction is not available through Clips until it is reimported as a Clips-hosted video.",
        ]
      : [
          "Use apis.frame.urlTemplate with atMs to fetch a JPEG frame when the spoken transcript references something visible on screen.",
          "Prefer recommendedFrames first, then request additional frames around transcript timestamps that matter for the task.",
        ]),
  ];

  return {
    type: "agent-native.clip.context",
    version: CLIP_AGENT_CONTEXT_VERSION,
    instructions,
    clip: {
      id: recording.id,
      title: recording.title,
      description: recording.description,
      publicPageUrl,
      sourceProvider: isLoomSource ? "loom" : null,
      thumbnailUrl: recording.thumbnailUrl,
      animatedThumbnailUrl: recording.animatedThumbnailUrl,
      durationMs: recording.durationMs,
      duration: recording.durationMs
        ? `${Math.round(recording.durationMs / 1000)}s`
        : null,
      width: recording.width,
      height: recording.height,
      hasAudio: Boolean(recording.hasAudio),
      hasCamera: Boolean(recording.hasCamera),
      status: recording.status,
      createdAt: recording.createdAt,
      updatedAt: recording.updatedAt,
    },
    apis: {
      context: { method: "GET", url: api.contextUrl },
      transcript: { method: "GET", url: api.transcriptUrl },
      ...(isLoomEmbedBacked
        ? {}
        : {
            frame: {
              method: "GET",
              urlTemplate: api.frameUrlTemplate,
              query: {
                atMs: "Video timestamp in milliseconds. The endpoint returns image/jpeg.",
              },
            },
          }),
    },
    transcript: {
      status: transcript?.status ?? "missing",
      language: transcript?.language ?? null,
      fullText: transcript?.fullText ?? "",
      segments: agentSegments,
      segmentCount: agentSegments.length,
    },
    chapters,
    recommendedFrames: suggestedFrames,
    browserDiagnostics: compactBrowserDiagnostics(browserDiagnostics ?? null),
    ctas: ctas.map((cta) => ({
      label: cta.label,
      url: cta.url,
      placement: cta.placement,
    })),
  };
}

function recordingFallbackMimeType(
  recording: Pick<PublicAgentRecording, "videoFormat">,
): string {
  return recording.videoFormat === "mp4" ? "video/mp4" : "video/webm";
}

function pickSourceMimeType(
  actual: string | null | undefined,
  fallback: string,
): string {
  const base = (actual ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base || base === "application/octet-stream") return fallback;
  return actual ?? fallback;
}

function statusCodeForMediaFetchError(err: unknown): number {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) return 403;
  if (err instanceof Error && /abort|timeout/i.test(err.name)) return 504;
  return 502;
}

function messageForMediaFetchError(err: unknown): string {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) {
    return "Recording media URL is blocked by server safety policy.";
  }
  if (err instanceof Error && /abort|timeout/i.test(err.name)) {
    return "Recording media fetch timed out.";
  }
  return "Recording media could not be fetched.";
}

export async function loadRecordingMediaBytes(
  recording: PublicAgentRecording,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const videoUrl = recording.videoUrl ?? "";
  if (!videoUrl) throw new Error("Recording has no videoUrl");
  if (isLoomEmbedBackedRecording(recording)) {
    throw new Error(
      "Frame extraction is not available for legacy Loom embed imports.",
    );
  }
  assertFrameMediaSize(recording.videoSizeBytes);

  const fallbackMimeType = recordingFallbackMimeType(recording);
  const isLocalBlob =
    videoUrl.startsWith("/api/video/") ||
    (videoUrl.startsWith("/api/uploads/") && videoUrl.endsWith("/blob"));

  if (isLocalBlob) {
    const stash = await appStateGet(
      recording.ownerEmail,
      `recording-blob-${recording.id}`,
    );
    const b64 = typeof stash?.data === "string" ? stash.data : null;
    if (!b64) throw new Error("recording-blob app-state missing");
    assertFrameMediaSize(estimateBase64DecodedByteLength(b64));
    const bytes = Buffer.from(normalizeBase64Payload(b64), "base64");
    assertFrameMediaSize(bytes.byteLength);
    const mimeType =
      typeof stash?.mimeType === "string" ? stash.mimeType : fallbackMimeType;
    return {
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType: pickSourceMimeType(mimeType, fallbackMimeType),
    };
  }

  let resolvedVideoUrl = videoUrl;
  const isAppRelativeUrl =
    resolvedVideoUrl.startsWith("/") && !resolvedVideoUrl.startsWith("//");
  if (isAppRelativeUrl) {
    const port = process.env.NITRO_PORT || process.env.PORT || "3000";
    const origin =
      process.env.PUBLIC_URL ??
      process.env.NITRO_PUBLIC_URL ??
      `http://localhost:${port}`;
    resolvedVideoUrl = `${origin}${resolvedVideoUrl}`;
  }

  let response: Response;
  try {
    response = isAppRelativeUrl
      ? await fetch(resolvedVideoUrl, { signal: AbortSignal.timeout(30_000) })
      : await ssrfSafeFetch(
          resolvedVideoUrl,
          { signal: AbortSignal.timeout(30_000) },
          { maxRedirects: 3 },
        );
  } catch (err) {
    throw new RecordingMediaFetchError(
      messageForMediaFetchError(err),
      statusCodeForMediaFetchError(err),
    );
  }

  if (!response.ok) {
    throw new RecordingMediaFetchError(
      `Recording media fetch failed: HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const bytes = await readResponseBytesWithLimit(response);
  return {
    bytes,
    mimeType: pickSourceMimeType(
      response.headers.get("content-type"),
      fallbackMimeType,
    ),
  };
}
