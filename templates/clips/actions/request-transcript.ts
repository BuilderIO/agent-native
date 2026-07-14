/**
 * Request transcription for a recording.
 *
 * Native transcript first: the web recorder uses the browser Web Speech API
 * and the desktop app uses macOS Speech. Those transcripts are saved via
 * `save-browser-transcript` and are authoritative. This action preserves an
 * existing native transcript, then only falls back to cloud transcription when
 * no native transcript exists.
 *
 * Cloud fallback provider selection:
 *   1. Builder.io transcription (Gemini 3.1 Flash-Lite behind the Builder
 *      proxy) when Builder is connected; if that model is unavailable in the
 *      deployment region, retry the Builder gateway's default model.
 *   2. `GROQ_API_KEY` → Groq's fast speech-to-text fallback.
 *   3. Neither → keep any native transcript or fail with a clear reason.
 *
 * Clips intentionally does not route recording transcription to OpenAI.
 * Native macOS/Web Speech output is the primary source; Gemini is reserved
 * for cleanup/title generation after native text exists.
 *
 * Native transcription: the browser's Web Speech API and desktop macOS Speech
 * run during recording and save an instant transcript via
 * `save-browser-transcript`. If this action finds a ready native transcript,
 * it preserves that result and only kicks off title generation.
 *
 * Fetches the recording media, extracts audio-only bytes, POSTs to the
 * provider with response_format=verbose_json and
 * timestamp_granularities[]=segment, and writes the result to
 * `recording_transcripts` with status='ready'.
 *
 * Usage:
 *   pnpm action request-transcript --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { resolveCredential } from "@agent-native/core/credentials";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { readAppSecret } from "@agent-native/core/secrets";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getCredentialContext,
} from "@agent-native/core/server/request-context";
import { getSetting, getUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { transcribeWithBuilder } from "@agent-native/core/transcription/builder";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import { isBuilderCreditsExhaustedMessage } from "../shared/builder-credits.js";
import { normalizeLoomShareUrl } from "../shared/loom.js";
import {
  buildCaptionSegmentsFromText,
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";
import cleanupTranscript from "./cleanup-transcript.js";
import exportToBrain from "./export-to-brain.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";
import {
  AudioOnlyExtractionError,
  assertAudioHasAudibleSignal,
  isNoExtractableAudioError,
  isTransientExtractionError,
  prepareAudioOnlyTranscriptionMedia,
  type AudioOnlyTranscriptionMedia,
} from "./lib/audio-only-transcription.js";
import {
  clearBuilderCreditsExhausted,
  noteBuilderCreditsExhausted,
} from "./lib/builder-credits-state.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./lib/loom-transcript.js";
import { isLoomRecording } from "./lib/native-media.js";
import {
  isLikelyMismatchedTranscriptLanguage,
  normalizeProviderTranscript,
} from "./lib/provider-transcript.js";
import { isAutoTitleReplaceable } from "./lib/title-source.js";
import regenerateSummary from "./regenerate-summary.js";
import regenerateTitle from "./regenerate-title.js";

interface SpeechToTextSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

interface SpeechToTextResponse {
  text: string;
  language?: string;
  segments?: SpeechToTextSegment[];
}

type TranscriptionProvider = {
  name: "groq";
  endpoint: string;
  model: string;
  apiKey: string;
};

type RecordingMediaRow = {
  videoUrl: string | null;
  videoFormat?: "webm" | "mp4" | null;
  videoSizeBytes?: number | null;
  hasAudio?: boolean | null;
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  durationMs?: number | null;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const BUILDER_GEMINI_TRANSCRIPTION_MODEL = "gemini-3-1-flash-lite";
const SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS =
  "Auto-detect the spoken language from the audio. Transcribe only words spoken in the audio, in the same language they were spoken. Do not translate. Do not infer language from screen text, filenames, account settings, browser locale, or these instructions. Do not describe screen activity, UI changes, silence, music, or non-speech sounds. Return an empty transcript when there are no spoken words.";
const CLIPS_USER_PREFS_KEY = "clips-user-prefs";
const RECENT_PENDING_TRANSCRIPT_MS = 2 * 60 * 1000;
const BUILDER_TRANSCRIPTION_MIN_TIMEOUT_MS = 45_000;
const BUILDER_TRANSCRIPTION_MAX_TIMEOUT_MS = 65_000;
const BUILDER_TRANSCRIPTION_BASE_TIMEOUT_MS = 30_000;
const BUILDER_TRANSCRIPTION_PER_MINUTE_MS = 3_000;
const MEDIA_FETCH_MIN_TIMEOUT_MS = 45_000;
const MEDIA_FETCH_MAX_TIMEOUT_MS = 120_000;
const MEDIA_FETCH_BASE_TIMEOUT_MS = 30_000;
const MEDIA_FETCH_PER_50MB_MS = 10_000;
const ESTIMATED_VIDEO_BYTES_PER_MINUTE = 5 * 1024 * 1024;

function builderErrorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return `${error.message} ${cause ? builderErrorText(cause) : ""}`.trim();
  }
  return String(error);
}

export function isBuilderModelAvailabilityError(error: unknown): boolean {
  const message = builderErrorText(error).toLowerCase();
  const identifiesModel =
    message.includes("model") || message.includes("gemini");
  const identifiesAvailability =
    message.includes("not available") ||
    message.includes("unavailable") ||
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("not found") ||
    message.includes("region") ||
    message.includes("location");
  return identifiesModel && identifiesAvailability;
}

export async function transcribeWithBuilderModelFallback(
  options: Omit<Parameters<typeof transcribeWithBuilder>[0], "model">,
) {
  try {
    return await transcribeWithBuilder({
      ...options,
      model: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
    });
  } catch (error) {
    if (!isBuilderModelAvailabilityError(error)) throw error;
    console.warn(
      `[clips] Builder transcription model ${BUILDER_GEMINI_TRANSCRIPTION_MODEL} is unavailable; retrying the gateway default model.`,
    );
    // `model` is optional on the Builder transcription endpoint. Omitting it
    // restores the gateway's region-aware default that Clips used before the
    // explicit Gemini model was introduced.
    return transcribeWithBuilder(options);
  }
}

function clampTimeoutMs(value: number): number {
  return Math.max(
    BUILDER_TRANSCRIPTION_MIN_TIMEOUT_MS,
    Math.min(BUILDER_TRANSCRIPTION_MAX_TIMEOUT_MS, Math.floor(value)),
  );
}

export function builderTranscriptionTimeoutMs(
  durationMs: number | null | undefined,
): number {
  const override = Number(process.env.CLIPS_BUILDER_TRANSCRIPTION_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) {
    return clampTimeoutMs(override);
  }

  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return BUILDER_TRANSCRIPTION_MIN_TIMEOUT_MS;
  }

  const durationMinutes = Math.ceil(durationMs / 60_000);
  return clampTimeoutMs(
    BUILDER_TRANSCRIPTION_BASE_TIMEOUT_MS +
      durationMinutes * BUILDER_TRANSCRIPTION_PER_MINUTE_MS,
  );
}

export function recordingMediaFetchTimeoutMs(
  videoSizeBytes: number | null | undefined,
  durationMs: number | null | undefined,
): number {
  const override = Number(
    process.env.CLIPS_TRANSCRIPTION_MEDIA_FETCH_TIMEOUT_MS,
  );
  if (Number.isFinite(override) && override > 0) {
    return Math.max(
      MEDIA_FETCH_MIN_TIMEOUT_MS,
      Math.min(MEDIA_FETCH_MAX_TIMEOUT_MS, Math.floor(override)),
    );
  }

  const estimatedBytes =
    videoSizeBytes && Number.isFinite(videoSizeBytes) && videoSizeBytes > 0
      ? videoSizeBytes
      : durationMs && Number.isFinite(durationMs) && durationMs > 0
        ? Math.ceil(durationMs / 60_000) * ESTIMATED_VIDEO_BYTES_PER_MINUTE
        : 0;
  if (!estimatedBytes) return MEDIA_FETCH_MIN_TIMEOUT_MS;

  const fiftyMbUnits = Math.ceil(estimatedBytes / (50 * 1024 * 1024));
  return Math.max(
    MEDIA_FETCH_MIN_TIMEOUT_MS,
    Math.min(
      MEDIA_FETCH_MAX_TIMEOUT_MS,
      MEDIA_FETCH_BASE_TIMEOUT_MS + fiftyMbUnits * MEDIA_FETCH_PER_50MB_MS,
    ),
  );
}

// Bounded automatic retry for transient failures (ffmpeg timeout, transient
// provider network/5xx errors) — NOT for permanent failures like "no audio
// track" or a missing/rejected API key. Each retry is self-dispatched into a
// fresh request so serverless runtimes cannot freeze a timer left behind by
// the completed transcription request.
const MAX_AUTO_TRANSCRIPT_RETRIES = 2;
const AUTO_TRANSCRIPT_RETRY_BACKOFF_MS = [5_000, 20_000];

function isTransientTranscriptionError(err: unknown): boolean {
  if (isTransientExtractionError(err)) return true;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    const message = err.message.toLowerCase();
    if (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("fetch failed") ||
      message.includes("network")
    ) {
      return true;
    }
    // Provider 5xx responses are transient; 4xx (bad key, bad request) are not.
    if (/\b5\d\d\b/.test(message) && message.includes("error")) return true;
  }
  return false;
}

/**
 * Schedule a bounded, backed-off automatic retry of `request-transcript` for
 * a transient failure in a fresh server request.
 *
 * `nextRetryCount` must already be persisted to `recording_transcripts` by the
 * caller BEFORE this is invoked (not inside the timer) so the retry budget
 * survives a process that never wakes back up to run the timer — a later
 * manual or automatic pass always sees the true attempt count. The dispatched
 * run is tagged `retryAttempt` (not `force` alone) so `run()` can tell an
 * automatic retry apart from a human/agent-initiated retry: automatic retries
 * consume the bounded budget, manual retries never do.
 */
function scheduleAutoTranscriptRetry({
  recordingId,
  nextRetryCount,
}: {
  recordingId: string;
  nextRetryCount: number;
}): void {
  if (nextRetryCount > MAX_AUTO_TRANSCRIPT_RETRIES) return;
  const backoffMs =
    AUTO_TRANSCRIPT_RETRY_BACKOFF_MS[nextRetryCount - 1] ??
    AUTO_TRANSCRIPT_RETRY_BACKOFF_MS[
      AUTO_TRANSCRIPT_RETRY_BACKOFF_MS.length - 1
    ];
  void dispatchPostFinalizeJob({
    recordingId,
    kind: "transcript",
    delayMs: backoffMs,
    retryAttempt: nextRetryCount,
  }).catch((err: unknown) => {
    console.warn(
      `[clips] auto-retry transcription dispatch failed for ${recordingId} (attempt ${nextRetryCount}):`,
      (err as Error)?.message ?? String(err),
    );
  });
}

function queueBrainExport(recordingId: string): void {
  void Promise.resolve(exportToBrain.run({ recordingId })).catch(
    (err: unknown) => {
      console.warn(
        `[clips] Brain export skipped for ${recordingId}:`,
        (err as Error)?.message ?? String(err),
      );
    },
  );
}

function verboseTranscriptErrors(): boolean {
  const debug = process.env.CLIPS_TRANSCRIPTION_DEBUG ?? "";
  return debug === "1" || debug.toLowerCase() === "true";
}

function serializeError(
  err: unknown,
  opts: { includeStack?: boolean } = {},
): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  return {
    name: err.name,
    message: err.message,
    ...(opts.includeStack && err.stack ? { stack: err.stack } : {}),
    ...(cause ? { cause: serializeError(cause, opts) } : {}),
  };
}

function summarizeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const root = rootCause(err);
  return `${root.name}: ${root.message}`;
}

function rootCause(err: Error): Error {
  const cause = (err as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? rootCause(cause) : err;
}

function recordingFallbackMimeType(
  rec: Pick<RecordingMediaRow, "videoFormat">,
): string {
  return rec.videoFormat === "mp4" ? "video/mp4" : "video/webm";
}

function pickSourceMimeType(
  actual: string | null | undefined,
  fallback: string,
): string {
  const base = (actual ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base || base === "application/octet-stream") return fallback;
  return actual ?? fallback;
}

async function loadRecordingMediaBlob({
  recordingId,
  videoUrl,
  fallbackMimeType,
  timeoutMs,
}: {
  recordingId: string;
  videoUrl: string;
  fallbackMimeType: string;
  timeoutMs: number;
}): Promise<{ blob: Blob; sourceMimeType: string }> {
  const isLocalBlob =
    videoUrl.startsWith("/api/video/") ||
    (videoUrl.startsWith("/api/uploads/") && videoUrl.endsWith("/blob"));
  if (isLocalBlob) {
    const stash = await readAppState(`recording-blob-${recordingId}`);
    const b64 = typeof stash?.data === "string" ? stash.data : null;
    if (!b64) throw new Error("recording-blob app-state missing");
    const bytes = Buffer.from(b64, "base64");
    const mime =
      typeof stash?.mimeType === "string" ? stash.mimeType : fallbackMimeType;
    return {
      blob: new Blob([bytes], { type: mime }),
      sourceMimeType: pickSourceMimeType(mime, fallbackMimeType),
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
  const vidRes = isAppRelativeUrl
    ? await fetch(resolvedVideoUrl, { signal: AbortSignal.timeout(timeoutMs) })
    : await ssrfSafeFetch(
        resolvedVideoUrl,
        { signal: AbortSignal.timeout(timeoutMs) },
        { maxRedirects: 3 },
      );
  if (!vidRes.ok) {
    throw new Error(
      `Failed to fetch videoUrl: HTTP ${vidRes.status} ${vidRes.statusText}`,
    );
  }
  const blob = await vidRes.blob();
  return {
    blob,
    sourceMimeType: pickSourceMimeType(blob.type, fallbackMimeType),
  };
}

function isRecentlyPendingTranscript(transcript: {
  status: string | null;
  updatedAt: string | null;
}): boolean {
  if (transcript.status !== "pending") return false;
  const updatedAtMs = Date.parse(transcript.updatedAt ?? "");
  return (
    Number.isFinite(updatedAtMs) &&
    Date.now() - updatedAtMs < RECENT_PENDING_TRANSCRIPT_MS
  );
}

async function writeTranscriptCleanupState(
  recordingId: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeAppState(`transcript-cleanup-${recordingId}`, {
    ...value,
    updatedAt: new Date().toISOString(),
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
}

function fullTextSegmentJson(
  text: string,
  durationMs: number | null | undefined,
): string {
  return JSON.stringify(buildCaptionSegmentsFromText(text, durationMs));
}

async function failEmptyProviderTranscript({
  db,
  recordingId,
  ownerEmail,
  providerName,
  now,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  providerName: string;
  now: string;
}) {
  const reason = `No speech was detected by ${providerName} transcription. Check microphone and speech permissions, then retry transcription.`;
  await upsertTranscriptRow(db, {
    recordingId,
    ownerEmail,
    status: "failed",
    failureReason: reason,
    segmentsJson: "[]",
    fullText: "",
    now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
  return {
    recordingId,
    status: "failed" as const,
    failureReason: reason,
  };
}

function resolveLoomTranscriptShareUrl(
  recording: RecordingMediaRow,
): string | null {
  return (
    normalizeLoomShareUrl(recording.sourceWindowTitle ?? "") ??
    normalizeLoomShareUrl(recording.videoUrl ?? "")
  );
}

export async function importLoomTranscriptForRecording({
  db,
  recordingId,
  ownerEmail,
  recording,
  now,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  recording: RecordingMediaRow;
  now: string;
}) {
  const shareUrl = resolveLoomTranscriptShareUrl(recording);
  let reason = shareUrl
    ? loomTranscriptUnavailableMessage()
    : "Loom transcript unavailable because this recording is missing its original Loom share URL. Re-import the Loom URL, or upload the original video file to use Clips transcription.";

  if (shareUrl) {
    try {
      const transcript = await fetchLoomTranscript({
        shareUrl,
        durationMs: recording.durationMs,
      });
      if (transcript) {
        await upsertTranscriptRow(db, {
          recordingId,
          ownerEmail,
          status: "ready",
          failureReason: null,
          language: transcript.language,
          segmentsJson: JSON.stringify(transcript.segments),
          fullText: transcript.fullText,
          now,
        });
        await writeAppState("refresh-signal", { ts: Date.now() });
        queueBrainExport(recordingId);
        return {
          recordingId,
          status: "ready" as const,
          segments: transcript.segments.length,
          provider: "loom" as const,
        };
      }
    } catch (err) {
      console.warn(
        `[clips] Loom transcript import failed for ${recordingId}:`,
        (err as Error)?.message ?? String(err),
      );
      reason = loomTranscriptUnavailableMessage();
    }
  }

  const preserved = await preserveReadyTranscriptIfAvailable({
    db,
    recordingId,
    ownerEmail,
  });
  if (preserved) return preserved;

  await upsertTranscriptRow(db, {
    recordingId,
    ownerEmail,
    status: "failed",
    failureReason: reason,
    segmentsJson: "[]",
    fullText: "",
    now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
  return {
    recordingId,
    status: "failed" as const,
    failureReason: reason,
    provider: "loom" as const,
  };
}

async function failAudioOnlyPreparation({
  db,
  recordingId,
  ownerEmail,
  err,
  now,
  currentRetryCount,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  err: unknown;
  now: string;
  currentRetryCount: number;
}): Promise<
  | {
      recordingId: string;
      status: "failed";
      failureReason: string;
    }
  | NonNullable<Awaited<ReturnType<typeof preserveReadyTranscriptIfAvailable>>>
> {
  const reason =
    err instanceof AudioOnlyExtractionError
      ? err.message
      : `Failed to prepare audio-only media for transcription: ${
          (err as Error)?.message ?? String(err)
        }`;

  const preserved = await preserveReadyTranscriptIfAvailable({
    db,
    recordingId,
    ownerEmail,
  });
  if (preserved) return preserved;

  const transient = isTransientTranscriptionError(err);
  const nextRetryCount = currentRetryCount + 1;

  await upsertTranscriptRow(db, {
    recordingId,
    ownerEmail,
    status: "failed",
    failureReason: reason,
    segmentsJson: "[]",
    fullText: "",
    now,
    ...(transient ? { retryCount: nextRetryCount } : {}),
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  if (transient) {
    scheduleAutoTranscriptRetry({ recordingId, nextRetryCount });
  }

  if (isNoExtractableAudioError(err)) {
    return {
      recordingId,
      status: "failed" as const,
      failureReason: reason,
    };
  }

  throw new Error(reason);
}

async function transcriptCleanupEnabled(): Promise<boolean> {
  const userEmail = getRequestUserEmail();
  if (userEmail) {
    const userSettings = await getUserSetting(
      userEmail,
      CLIPS_USER_PREFS_KEY,
    ).catch(() => null);
    if (userSettings && "transcriptCleanupEnabled" in userSettings) {
      return userSettings.transcriptCleanupEnabled !== false;
    }
  }

  const settings = await getSetting(CLIPS_USER_PREFS_KEY).catch(() => null);
  return settings?.transcriptCleanupEnabled !== false;
}

/**
 * Read the language already detected/stored on this recording's transcript row.
 * Cleanup and renormalization must preserve a detected non-English language
 * rather than clobbering it back to "en". Falls back to "en" only when no row
 * (or no language) exists yet.
 */
async function resolveStoredLanguage(
  db: ReturnType<typeof getDb>,
  recordingId: string,
): Promise<string> {
  const [row] = await db
    .select({ language: schema.recordingTranscripts.language })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);
  return row?.language?.trim() || "en";
}

async function cleanupNativeTranscript({
  db,
  recordingId,
  ownerEmail,
  fullText,
  durationMs,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  fullText: string;
  durationMs: number | null | undefined;
}): Promise<{ cleaned: boolean; provider?: string }> {
  const sourceText = fullText.trim();
  if (!sourceText) return { cleaned: false };

  if (!(await transcriptCleanupEnabled())) {
    await writeTranscriptCleanupState(recordingId, {
      status: "disabled",
    });
    return { cleaned: false };
  }

  await writeTranscriptCleanupState(recordingId, {
    status: "running",
    provider: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
    startedAt: new Date().toISOString(),
  });

  try {
    const agentsContext = await loadAgentsMdContext({
      ownerEmail,
      purpose: "cleanup",
    });
    const result = await cleanupTranscript.run({
      transcript: sourceText,
      task: "cleanup",
      context: agentsContext,
    });
    const cleanedText = result.cleanedText?.trim();
    if (!cleanedText || cleanedText === sourceText) {
      await writeTranscriptCleanupState(recordingId, {
        status: "unchanged",
        provider: result.provider,
      });
      return { cleaned: false, provider: result.provider };
    }

    const now = new Date().toISOString();
    const language = await resolveStoredLanguage(db, recordingId);
    await upsertTranscriptRow(db, {
      recordingId,
      ownerEmail,
      status: "ready",
      failureReason: null,
      language,
      segmentsJson: fullTextSegmentJson(cleanedText, durationMs),
      fullText: cleanedText,
      now,
    });
    await writeTranscriptCleanupState(recordingId, {
      status: "ready",
      provider: result.provider,
    });

    return { cleaned: true, provider: result.provider };
  } catch (err) {
    const details = serializeError(err);
    console.warn(
      `[clips] native transcript cleanup skipped for ${recordingId}: ${summarizeError(err)}`,
    );
    if (verboseTranscriptErrors()) {
      console.warn(
        "[clips] native transcript cleanup error details",
        serializeError(err, { includeStack: true }),
      );
    }
    await writeTranscriptCleanupState(recordingId, {
      status: "failed",
      provider: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
      failureReason: (err as Error)?.message ?? String(err),
      details,
    });
    return { cleaned: false };
  }
}

async function generateRecordingMetadata({
  recordingId,
  title,
  titleSource,
  description,
  transcriptText,
}: {
  recordingId: string;
  title: string | null | undefined;
  titleSource: string | null | undefined;
  description: string | null | undefined;
  transcriptText: string;
}): Promise<{ titleQueued: boolean; summaryQueued: boolean }> {
  if (isAutoTitleReplaceable(title, titleSource)) {
    await regenerateTitle.run({
      recordingId,
      transcriptText,
      includeSummary: !description?.trim(),
    });
    return {
      titleQueued: true,
      summaryQueued: !description?.trim(),
    };
  }

  if (!description?.trim()) {
    await regenerateSummary.run({ recordingId });
    return { titleQueued: false, summaryQueued: true };
  }

  return { titleQueued: false, summaryQueued: false };
}

async function completeReadyTranscript({
  db,
  recordingId,
  ownerEmail,
  fullText,
  segmentsJson,
  preserved = false,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  fullText: string;
  segmentsJson?: string | null;
  preserved?: boolean;
}): Promise<{
  recordingId: string;
  status: "ready";
  cleaned: boolean;
  provider: "existing" | "native";
  cleanupQueued: boolean;
  titleQueued: boolean;
  summaryQueued: boolean;
  preserved?: true;
}> {
  const [recForTitle] = await db
    .select({
      title: schema.recordings.title,
      titleSource: schema.recordings.titleSource,
      description: schema.recordings.description,
      durationMs: schema.recordings.durationMs,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);

  const normalizedSegments = normalizeTranscriptSegments({
    segments: parseTranscriptSegments(segmentsJson),
    fullText,
    durationMs: recForTitle?.durationMs,
  });
  if (normalizedSegments.length) {
    const normalizedSegmentsJson = JSON.stringify(normalizedSegments);
    if (normalizedSegmentsJson !== (segmentsJson ?? "[]")) {
      const language = await resolveStoredLanguage(db, recordingId);
      await upsertTranscriptRow(db, {
        recordingId,
        ownerEmail,
        status: "ready",
        failureReason: null,
        language,
        segmentsJson: normalizedSegmentsJson,
        fullText,
        now: new Date().toISOString(),
      });
      segmentsJson = normalizedSegmentsJson;
    }
  }

  const cleanupPromise = cleanupNativeTranscript({
    db,
    recordingId,
    ownerEmail,
    fullText,
    durationMs: recForTitle?.durationMs,
  }).catch((err) => {
    console.warn(
      `[clips] native transcript cleanup failed for ${recordingId}:`,
      (err as Error)?.message ?? String(err),
    );
    return { cleaned: false };
  });

  const metadataPromise = recForTitle
    ? generateRecordingMetadata({
        recordingId,
        title: recForTitle.title,
        titleSource: recForTitle.titleSource,
        description: recForTitle.description,
        transcriptText: fullText,
      }).catch((err: unknown) => {
        console.warn(
          `[clips] native-transcript metadata generation failed for ${recordingId}:`,
          (err as Error)?.message ?? String(err),
        );
        return { titleQueued: false, summaryQueued: false };
      })
    : Promise.resolve({ titleQueued: false, summaryQueued: false });

  // Both calls are independent. Await them together so the durable worker stays
  // alive without serially stacking two model-call timeouts.
  const [cleanupResult, metadataResult] = await Promise.all([
    cleanupPromise,
    metadataPromise,
  ]);

  if (!recForTitle) {
    console.warn(
      `[clips] recording metadata generation skipped because ${recordingId} was not found`,
    );
  }

  if (metadataResult.titleQueued) {
    console.log(
      `[clips] transcript-backed title generation completed or queued for ${recordingId}`,
    );
  }
  if (metadataResult.summaryQueued) {
    console.log(
      `[clips] transcript-backed summary generation queued for ${recordingId}`,
    );
  }

  // Wake the player polling so it picks up the queued cleanup state row
  // (`transcript-cleanup-${recordingId}`) before its next 2s tick lands —
  // otherwise the "Cleaning up…" badge can lag for one full poll interval.
  await writeAppState("refresh-signal", { ts: Date.now() });
  queueBrainExport(recordingId);

  return {
    recordingId,
    status: "ready",
    cleaned: cleanupResult.cleaned,
    provider: segmentsJson && segmentsJson !== "[]" ? "existing" : "native",
    cleanupQueued: false,
    titleQueued: metadataResult.titleQueued,
    summaryQueued: metadataResult.summaryQueued,
    ...(preserved ? { preserved: true as const } : {}),
  };
}

async function preserveReadyTranscriptIfAvailable({
  db,
  recordingId,
  ownerEmail,
  allowLikelyLanguageMismatch = true,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  allowLikelyLanguageMismatch?: boolean;
}): Promise<{
  recordingId: string;
  status: "ready";
  cleaned: boolean;
  provider: "existing" | "native";
  cleanupQueued: boolean;
  titleQueued: boolean;
  summaryQueued: boolean;
  preserved?: true;
} | null> {
  const [current] = await db
    .select({
      status: schema.recordingTranscripts.status,
      fullText: schema.recordingTranscripts.fullText,
      segmentsJson: schema.recordingTranscripts.segmentsJson,
      language: schema.recordingTranscripts.language,
    })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);

  if (current?.status === "ready" && current.fullText?.trim()) {
    if (
      !allowLikelyLanguageMismatch &&
      isLikelyMismatchedTranscriptLanguage(current.language, current.fullText)
    ) {
      console.warn(
        `[clips] Ready transcript for ${recordingId} looks language-mismatched (${current.language}); retrying cloud transcription instead of preserving it.`,
      );
      return null;
    }
    console.log(
      `[clips] Keeping ready native transcript for ${recordingId}; cloud fallback result ignored`,
    );
    return completeReadyTranscript({
      db,
      recordingId,
      ownerEmail,
      fullText: current.fullText,
      segmentsJson: current.segmentsJson,
      preserved: true,
    });
  }

  return null;
}

/**
 * Resolve a secret from (in order):
 *   1. Per-user secret store (sidebar settings UI, encrypted at rest)
 *   2. `resolveCredential` (per-user / per-org SQL settings rows)
 */
async function resolveKey(
  key: string,
  userEmail: string | null,
): Promise<string | undefined> {
  if (userEmail) {
    const userSecret = await readAppSecret({
      key,
      scope: "user",
      scopeId: userEmail,
    }).catch(() => null);
    if (userSecret?.value) return userSecret.value;
  }
  const credCtx = getCredentialContext();
  if (!credCtx) {
    // No active request context — refuse to fall back to a global lookup
    // because there is no user/org to scope the credential read to.
    return undefined;
  }
  const fromCreds = await resolveCredential(key, credCtx);
  return fromCreds ?? undefined;
}

async function pickProvider(
  userEmail: string | null,
): Promise<TranscriptionProvider | null> {
  // Prefer Groq when Builder/native are unavailable — it is the fast
  // Whisper-compatible speech-to-text fallback. Clips no longer falls back
  // to OpenAI for recording transcription.
  const groqKey = await resolveKey("GROQ_API_KEY", userEmail);
  if (groqKey) {
    return {
      name: "groq",
      endpoint: GROQ_ENDPOINT,
      model: GROQ_MODEL,
      apiKey: groqKey,
    };
  }
  return null;
}

const requestTranscriptAction = defineAction({
  description:
    "Ensure a recording has a transcript, or explicitly regenerate it from the recording media. Preserves native Web Speech/macOS Speech transcripts unless regenerate is true, then uses Builder.io managed transcription or the configured Groq fallback.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    force: z
      .boolean()
      .optional()
      .describe(
        "Bypass the recent pending guard for explicit retries or the finalize-recording background worker.",
      ),
    regenerate: z
      .boolean()
      .optional()
      .describe(
        "Generate a fresh transcript from the recording media even when a ready transcript already exists. The existing ready transcript is kept if regeneration fails.",
      ),
    retryAttempt: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Internal — set only by the bounded automatic retry scheduler after a transient failure (ffmpeg timeout, transient provider error). Do not set this when calling request-transcript manually or from the agent; omitting it means the retry budget never applies to this call.",
      ),
  }),
  run: async (args, context?: ActionRunContext) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    if (context?.caller === "tool") {
      const [existingTranscript] = await db
        .select({
          status: schema.recordingTranscripts.status,
          updatedAt: schema.recordingTranscripts.updatedAt,
        })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .limit(1);
      if (
        existingTranscript &&
        isRecentlyPendingTranscript(existingTranscript)
      ) {
        console.log(
          `[clips] Transcript already pending for ${args.recordingId}; skipping duplicate agent request.`,
        );
        return {
          recordingId: args.recordingId,
          status: "pending" as const,
          skipped: true,
          reason: "already-pending",
        };
      }

      await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "transcript",
        ...(args.regenerate ? { regenerate: true } : {}),
      });
      return {
        recordingId: args.recordingId,
        status: "pending" as const,
        queued: true,
        regenerate: Boolean(args.regenerate),
        provider: "background" as const,
      };
    }

    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    const userEmail = getRequestUserEmail() ?? ownerEmail;
    let builderError: string | null = null;
    let audioMediaPromise: Promise<AudioOnlyTranscriptionMedia> | null = null;
    let audioSignalPromise: Promise<void> | null = null;

    const getAudioMedia = (
      rec: RecordingMediaRow,
    ): Promise<AudioOnlyTranscriptionMedia> => {
      const videoUrl = rec.videoUrl;
      if (!videoUrl) throw new Error("Recording has no videoUrl");
      if (rec.hasAudio === false) {
        throw new AudioOnlyExtractionError(
          "NO_AUDIO_TRACK",
          "No speech was detected because this recording was saved without audio.",
        );
      }
      audioMediaPromise ??= (async () => {
        const fallbackMimeType = recordingFallbackMimeType(rec);
        const media = await loadRecordingMediaBlob({
          recordingId: args.recordingId,
          videoUrl,
          fallbackMimeType,
          timeoutMs: recordingMediaFetchTimeoutMs(
            rec.videoSizeBytes,
            rec.durationMs,
          ),
        });
        return prepareAudioOnlyTranscriptionMedia({
          blob: media.blob,
          recordingId: args.recordingId,
          sourceMimeType: media.sourceMimeType,
        });
      })();
      return audioMediaPromise;
    };
    const ensureAudioHasSignal = (
      media: AudioOnlyTranscriptionMedia,
    ): Promise<void> => {
      audioSignalPromise ??= assertAudioHasAudibleSignal(media);
      return audioSignalPromise;
    };

    const [existingNativeTranscript] = await db
      .select({
        status: schema.recordingTranscripts.status,
        fullText: schema.recordingTranscripts.fullText,
        segmentsJson: schema.recordingTranscripts.segmentsJson,
        updatedAt: schema.recordingTranscripts.updatedAt,
        language: schema.recordingTranscripts.language,
        retryCount: schema.recordingTranscripts.retryCount,
      })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    // Persisted retry budget entering this run. A manual/agent retry
    // (force=true, no retryAttempt) is NEVER blocked by this count — it always
    // runs. Only whether a FUTURE failure schedules another automatic retry
    // depends on it (see scheduleAutoTranscriptRetry's own cap check), so a
    // manual retry can still top the budget back up for one more bounded
    // automatic pass if it fails transiently again.
    const currentRetryCount = existingNativeTranscript?.retryCount ?? 0;
    const regeneratingReadyTranscript = Boolean(
      args.regenerate &&
      existingNativeTranscript?.status === "ready" &&
      existingNativeTranscript.fullText?.trim(),
    );
    if (args.retryAttempt !== undefined) {
      console.log(
        `[clips] auto-retry transcription attempt ${args.retryAttempt} for ${args.recordingId}`,
      );
    }

    if (
      !args.regenerate &&
      existingNativeTranscript?.status === "ready" &&
      existingNativeTranscript.fullText?.trim()
    ) {
      if (
        isLikelyMismatchedTranscriptLanguage(
          existingNativeTranscript.language,
          existingNativeTranscript.fullText,
        )
      ) {
        console.warn(
          `[clips] Ready transcript for ${args.recordingId} looks language-mismatched (${existingNativeTranscript.language}); retrying transcription instead of preserving it.`,
        );
      } else {
        return completeReadyTranscript({
          db,
          recordingId: args.recordingId,
          ownerEmail,
          fullText: existingNativeTranscript.fullText,
          segmentsJson: existingNativeTranscript.segmentsJson,
        });
      }
    }

    if (
      !args.force &&
      existingNativeTranscript &&
      isRecentlyPendingTranscript(existingNativeTranscript)
    ) {
      console.log(
        `[clips] Transcript already pending for ${args.recordingId}; skipping duplicate request.`,
      );
      return {
        recordingId: args.recordingId,
        status: "pending" as const,
        skipped: true,
        reason: "already-pending",
      };
    }

    // ── Builder transcription (cloud fallback) ────────────────────────
    // Builder proxy is available when the current user has connected
    // Builder via OAuth (per-user app_secrets) OR when BUILDER_PRIVATE_KEY
    // is set at the deployment level. Use the per-user-aware resolver so
    // a sidebar OAuth connection actually wires through to transcription.
    if (await resolveHasBuilderPrivateKey()) {
      if (!regeneratingReadyTranscript) {
        await upsertTranscriptRow(db, {
          recordingId: args.recordingId,
          ownerEmail,
          status: "pending",
          failureReason: null,
          now,
        });
        await writeAppState("refresh-signal", { ts: Date.now() });
      }

      const [rec] = await db
        .select({
          videoUrl: schema.recordings.videoUrl,
          videoFormat: schema.recordings.videoFormat,
          videoSizeBytes: schema.recordings.videoSizeBytes,
          hasAudio: schema.recordings.hasAudio,
          sourceAppName: schema.recordings.sourceAppName,
          sourceWindowTitle: schema.recordings.sourceWindowTitle,
          durationMs: schema.recordings.durationMs,
          title: schema.recordings.title,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId))
        .limit(1);
      if (!rec || !rec.videoUrl) {
        const reason = "Recording has no videoUrl";
        const preserved = await preserveReadyTranscriptIfAvailable({
          db,
          recordingId: args.recordingId,
          ownerEmail,
        });
        if (preserved) return preserved;
        await upsertTranscriptRow(db, {
          recordingId: args.recordingId,
          ownerEmail,
          status: "failed",
          failureReason: reason,
          now,
        });
        await writeAppState("refresh-signal", { ts: Date.now() });
        throw new Error(reason);
      }
      if (isLoomRecording(rec)) {
        return importLoomTranscriptForRecording({
          db,
          recordingId: args.recordingId,
          ownerEmail,
          recording: rec,
          now,
        });
      }

      let audioMedia: AudioOnlyTranscriptionMedia;
      try {
        audioMedia = await getAudioMedia(rec);
        await ensureAudioHasSignal(audioMedia);
      } catch (err) {
        return failAudioOnlyPreparation({
          db,
          recordingId: args.recordingId,
          ownerEmail,
          err,
          now,
          currentRetryCount,
        });
      }

      try {
        const startedAt = Date.now();
        const builderResult = await transcribeWithBuilderModelFallback({
          audioBytes: audioMedia.audioBytes,
          mimeType: audioMedia.mimeType,
          diarize: false,
          instructions: SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS,
          timeoutMs: builderTranscriptionTimeoutMs(rec.durationMs),
        });

        const segments = (builderResult.segments ?? [])
          .map((s) => ({
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text.trim(),
          }))
          .filter((segment) => segment.text);
        const normalizedTranscript = normalizeProviderTranscript(
          builderResult.text,
          segments,
        );
        const fullText = normalizedTranscript.fullText;

        if (!regeneratingReadyTranscript) {
          const preserved = await preserveReadyTranscriptIfAvailable({
            db,
            recordingId: args.recordingId,
            ownerEmail,
            allowLikelyLanguageMismatch: false,
          });
          if (preserved) return preserved;
        }

        if (!fullText) {
          return failEmptyProviderTranscript({
            db,
            recordingId: args.recordingId,
            ownerEmail,
            providerName: "Builder",
            now,
          });
        }

        await upsertTranscriptRow(db, {
          recordingId: args.recordingId,
          ownerEmail,
          status: "ready",
          failureReason: null,
          language: builderResult.language ?? "en",
          segmentsJson: JSON.stringify(normalizedTranscript.segments),
          fullText,
          now,
        });
        await writeAppState("refresh-signal", { ts: Date.now() });
        queueBrainExport(args.recordingId);
        await clearBuilderCreditsExhausted();

        // Re-read title fresh — `rec.title` was fetched before the 30+ s
        // transcription and may be stale if the user renamed during that window.
        const [freshRec] = await db
          .select({
            title: schema.recordings.title,
            titleSource: schema.recordings.titleSource,
            description: schema.recordings.description,
          })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);
        if (freshRec) {
          try {
            await generateRecordingMetadata({
              recordingId: args.recordingId,
              title: freshRec.title,
              titleSource: freshRec.titleSource,
              description: freshRec.description,
              transcriptText: fullText,
            });
          } catch (delegateErr) {
            console.warn(
              `[clips] automatic metadata generation failed for ${args.recordingId}:`,
              (delegateErr as Error).message,
            );
          }
        }

        const elapsedMs = Date.now() - startedAt;
        console.log(
          `Transcribed recording ${args.recordingId} via builder in ${elapsedMs}ms (${normalizedTranscript.segments.length} segments)`,
        );
        return {
          recordingId: args.recordingId,
          status: "ready" as const,
          segments: normalizedTranscript.segments.length,
          provider: "builder",
        };
      } catch (err) {
        const reason = (err as Error).message;
        const details = serializeError(err);
        if (isBuilderCreditsExhaustedMessage(reason)) {
          await noteBuilderCreditsExhausted({
            source: "transcription",
            message: reason,
          });
          builderError = reason;
          console.warn(
            `[clips] Builder credits exhausted for ${args.recordingId}; preserving native transcript if present and falling back to Groq if configured.`,
          );
        } else {
          builderError = reason;
          console.warn(
            `[clips] Builder transcription failed for ${args.recordingId}: ${summarizeError(err)}. Preserving native transcript if present and falling back to Groq if configured.`,
          );
          if (verboseTranscriptErrors()) {
            console.warn(
              "[clips] Builder transcription error details",
              serializeError(err, { includeStack: true }),
            );
          }
        }
        await writeTranscriptCleanupState(args.recordingId, {
          status: "builder-transcription-failed",
          provider: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
          failureReason: reason,
          details,
        });
      }
    }

    // ── Groq fallback ─────────────────────────────────────────────────
    // Resolve the provider BEFORE overwriting the transcript row — if no
    // key is configured but a native transcript already exists
    // (from Web Speech API or macOS Speech during recording), preserve it instead of
    // clobbering it with "pending" then "failed".
    const provider = await pickProvider(userEmail);
    if (!provider) {
      const preserved = await preserveReadyTranscriptIfAvailable({
        db,
        recordingId: args.recordingId,
        ownerEmail,
      });
      if (preserved) return preserved;

      const reason = builderError
        ? "No native transcript was captured, and backup transcription could not finish. Retry transcription or check microphone and speech permissions."
        : "No transcript was captured by native speech recognition, and no backup transcription provider is configured.";
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: reason,
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.warn(`[clips] ${reason}`);
      return {
        recordingId: args.recordingId,
        status: "failed" as const,
        failureReason: reason,
      };
    }

    // Upsert a pending row so the UI can show "Transcribing…".
    if (!regeneratingReadyTranscript) {
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "pending",
        failureReason: null,
        now,
      });

      await writeAppState("refresh-signal", { ts: Date.now() });
    }

    // Load the recording's media URL and prepare audio-only bytes. We never
    // send video frames to a transcription provider; screen-only recordings
    // without speech should become an empty/no-speech transcript instead of a
    // visual narration.
    const [rec] = await db
      .select({
        videoUrl: schema.recordings.videoUrl,
        videoFormat: schema.recordings.videoFormat,
        videoSizeBytes: schema.recordings.videoSizeBytes,
        hasAudio: schema.recordings.hasAudio,
        sourceAppName: schema.recordings.sourceAppName,
        sourceWindowTitle: schema.recordings.sourceWindowTitle,
        durationMs: schema.recordings.durationMs,
        title: schema.recordings.title,
        titleSource: schema.recordings.titleSource,
        description: schema.recordings.description,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec || !rec.videoUrl) {
      const reason = "Recording has no videoUrl";
      const preserved = await preserveReadyTranscriptIfAvailable({
        db,
        recordingId: args.recordingId,
        ownerEmail,
      });
      if (preserved) return preserved;
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: reason,
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      throw new Error(reason);
    }
    if (isLoomRecording(rec)) {
      return importLoomTranscriptForRecording({
        db,
        recordingId: args.recordingId,
        ownerEmail,
        recording: rec,
        now,
      });
    }

    let audioMedia: AudioOnlyTranscriptionMedia;
    try {
      audioMedia = await getAudioMedia(rec);
      await ensureAudioHasSignal(audioMedia);
    } catch (err) {
      return failAudioOnlyPreparation({
        db,
        recordingId: args.recordingId,
        ownerEmail,
        err,
        now,
        currentRetryCount,
      });
    }

    // Post to the provider. Groq accepts the OpenAI-compatible form shape.
    const form = new FormData();
    form.append(
      "file",
      new Blob([audioMedia.audioBytes as BlobPart], {
        type: audioMedia.mimeType,
      }),
      audioMedia.filename,
    );
    form.append("model", provider.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    form.append("prompt", SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const startedAt = Date.now();
      const res = await fetch(provider.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          res.status === 401
            ? `${provider.name} rejected the API key. Update it in Settings → API Keys.`
            : `${provider.name} transcription error ${res.status}: ${text.slice(0, 300)}`,
        );
      }
      const data = (await res.json()) as SpeechToTextResponse;

      const segments = (data.segments ?? [])
        .map((s) => ({
          startMs: Math.max(0, Math.round(s.start * 1000)),
          endMs: Math.max(0, Math.round(s.end * 1000)),
          text: s.text.trim(),
        }))
        .filter((segment) => segment.text);
      const normalizedTranscript = normalizeProviderTranscript(
        data.text,
        segments,
      );
      const fullText = normalizedTranscript.fullText;

      if (!regeneratingReadyTranscript) {
        const preserved = await preserveReadyTranscriptIfAvailable({
          db,
          recordingId: args.recordingId,
          ownerEmail,
          allowLikelyLanguageMismatch: false,
        });
        if (preserved) return preserved;
      }

      if (!fullText) {
        return failEmptyProviderTranscript({
          db,
          recordingId: args.recordingId,
          ownerEmail,
          providerName: provider.name,
          now,
        });
      }

      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "ready",
        failureReason: null,
        language: data.language ?? "en",
        segmentsJson: JSON.stringify(normalizedTranscript.segments),
        fullText,
        now,
      });

      await writeAppState("refresh-signal", { ts: Date.now() });
      queueBrainExport(args.recordingId);

      // Generate transcript-backed metadata without replacing a human title or
      // description. The title action keeps any local heuristic replaceable
      // while its agent refinement runs.
      try {
        await generateRecordingMetadata({
          recordingId: args.recordingId,
          title: rec.title,
          titleSource: rec.titleSource,
          description: rec.description,
          transcriptText: fullText,
        });
      } catch (delegateErr) {
        console.warn(
          `[clips] automatic metadata generation failed for ${args.recordingId}:`,
          (delegateErr as Error).message,
        );
      }

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `Transcribed recording ${args.recordingId} via ${provider.name} (${provider.model}) in ${elapsedMs}ms (${normalizedTranscript.segments.length} segments)`,
      );
      return {
        recordingId: args.recordingId,
        status: "ready" as const,
        segments: normalizedTranscript.segments.length,
        provider: provider.name,
      };
    } catch (err) {
      const reason =
        (err as Error)?.name === "AbortError"
          ? `${provider.name} transcription timed out after 45 seconds.`
          : (err as Error).message;
      const preserved = await preserveReadyTranscriptIfAvailable({
        db,
        recordingId: args.recordingId,
        ownerEmail,
      });
      if (preserved) return preserved;
      const transient = isTransientTranscriptionError(err);
      const nextRetryCount = currentRetryCount + 1;
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: reason,
        now,
        ...(transient ? { retryCount: nextRetryCount } : {}),
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      if (transient) {
        scheduleAutoTranscriptRetry({
          recordingId: args.recordingId,
          nextRetryCount,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
});

async function upsertTranscriptRow(
  db: ReturnType<typeof getDb>,
  row: {
    recordingId: string;
    ownerEmail: string;
    status: "pending" | "ready" | "failed";
    failureReason: string | null;
    language?: string;
    segmentsJson?: string;
    fullText?: string;
    now: string;
    /**
     * Automatic-retry attempt count to persist. Pass explicitly when a
     * transient failure is about to schedule an auto-retry so the budget
     * survives even if the scheduled retry never runs (e.g. a serverless
     * sandbox freezing before the timer fires). A `"ready"` status always
     * resets the count to 0 so a later failure gets a fresh retry budget.
     * Omit to leave the stored count untouched (the common case).
     */
    retryCount?: number;
  },
): Promise<void> {
  const [existing] = await db
    .select({ recordingId: schema.recordingTranscripts.recordingId })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, row.recordingId))
    .limit(1);

  const retryCount = row.status === "ready" ? 0 : (row.retryCount ?? undefined);

  if (existing) {
    await db
      .update(schema.recordingTranscripts)
      .set({
        ownerEmail: row.ownerEmail,
        status: row.status,
        failureReason: row.failureReason,
        ...(row.language ? { language: row.language } : {}),
        ...(row.segmentsJson ? { segmentsJson: row.segmentsJson } : {}),
        ...(row.fullText !== undefined ? { fullText: row.fullText } : {}),
        ...(retryCount !== undefined ? { retryCount } : {}),
        updatedAt: row.now,
      })
      .where(eq(schema.recordingTranscripts.recordingId, row.recordingId));
  } else {
    await db.insert(schema.recordingTranscripts).values({
      recordingId: row.recordingId,
      ownerEmail: row.ownerEmail,
      language: row.language ?? "en",
      segmentsJson: row.segmentsJson ?? "[]",
      fullText: row.fullText ?? "",
      status: row.status,
      failureReason: row.failureReason,
      retryCount: retryCount ?? 0,
      createdAt: row.now,
      updatedAt: row.now,
    });
  }
}

export default requestTranscriptAction;
