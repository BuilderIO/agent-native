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
 *      proxy) when Builder is connected.
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
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { getSetting } from "@agent-native/core/settings";
import { resolveCredential } from "@agent-native/core/credentials";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { readAppSecret } from "@agent-native/core/secrets";
import {
  getRequestUserEmail,
  getCredentialContext,
} from "@agent-native/core/server/request-context";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";
import { transcribeWithBuilder } from "@agent-native/core/transcription/builder";
import regenerateTitle, {
  queueTitleRegenerationRequest,
} from "./regenerate-title.js";
import exportToBrain from "./export-to-brain.js";
import cleanupTranscript from "./cleanup-transcript.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";
import { isAutoTitleReplaceable } from "./lib/title-source.js";
import {
  buildCaptionSegmentsFromText,
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";
import {
  AudioOnlyExtractionError,
  assertAudioHasAudibleSignal,
  isNoExtractableAudioError,
  prepareAudioOnlyTranscriptionMedia,
  type AudioOnlyTranscriptionMedia,
} from "./lib/audio-only-transcription.js";
import { normalizeProviderTranscript } from "./lib/provider-transcript.js";

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
  hasAudio?: boolean | null;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const BUILDER_GEMINI_TRANSCRIPTION_MODEL = "gemini-3-1-flash-lite";
const SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS =
  "Transcribe only words spoken in the audio. Do not describe screen activity, UI changes, silence, music, or non-speech sounds. Return an empty transcript when there are no spoken words.";
const CLIPS_USER_PREFS_KEY = "clips-user-prefs";
const RECENT_PENDING_TRANSCRIPT_MS = 2 * 60 * 1000;

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
}: {
  recordingId: string;
  videoUrl: string;
  fallbackMimeType: string;
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
    ? await fetch(resolvedVideoUrl, { signal: AbortSignal.timeout(30_000) })
    : await ssrfSafeFetch(
        resolvedVideoUrl,
        { signal: AbortSignal.timeout(30_000) },
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

async function failAudioOnlyPreparation({
  db,
  recordingId,
  ownerEmail,
  err,
  now,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
  err: unknown;
  now: string;
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
  preserved?: true;
}> {
  const [recForTitle] = await db
    .select({
      title: schema.recordings.title,
      titleSource: schema.recordings.titleSource,
      durationMs: schema.recordings.durationMs,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.ownerEmail, ownerEmail),
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

  void cleanupNativeTranscript({
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
  });

  const titleQueued = !!(
    recForTitle &&
    isAutoTitleReplaceable(recForTitle.title, recForTitle.titleSource)
  );
  if (titleQueued) {
    await queueTitleRegenerationRequest({
      recordingId,
      currentTitle: recForTitle.title,
      transcriptText: fullText,
      transcriptStatus: "ready",
      segmentsJson,
      ownerEmail,
    }).catch((err) => {
      console.warn(
        `[clips] native-transcript title request queue failed for ${recordingId}:`,
        (err as Error)?.message ?? String(err),
      );
    });

    void Promise.resolve(
      regenerateTitle.run({
        recordingId,
        transcriptText: fullText,
      }),
    ).catch((err: unknown) => {
      console.warn(
        `[clips] native-transcript title generation failed for ${recordingId}:`,
        (err as Error)?.message ?? String(err),
      );
    });
  }

  // Wake the player polling so it picks up the queued cleanup state row
  // (`transcript-cleanup-${recordingId}`) before its next 2s tick lands —
  // otherwise the "Cleaning up…" badge can lag for one full poll interval.
  await writeAppState("refresh-signal", { ts: Date.now() });
  queueBrainExport(recordingId);

  return {
    recordingId,
    status: "ready",
    cleaned: false,
    provider: segmentsJson && segmentsJson !== "[]" ? "existing" : "native",
    cleanupQueued: true,
    titleQueued,
    ...(preserved ? { preserved: true as const } : {}),
  };
}

async function preserveReadyTranscriptIfAvailable({
  db,
  recordingId,
  ownerEmail,
}: {
  db: ReturnType<typeof getDb>;
  recordingId: string;
  ownerEmail: string;
}): Promise<{
  recordingId: string;
  status: "ready";
  cleaned: boolean;
  provider: "existing" | "native";
  cleanupQueued: boolean;
  titleQueued: boolean;
  preserved?: true;
} | null> {
  const [current] = await db
    .select({
      status: schema.recordingTranscripts.status,
      fullText: schema.recordingTranscripts.fullText,
      segmentsJson: schema.recordingTranscripts.segmentsJson,
    })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);

  if (current?.status === "ready" && current.fullText?.trim()) {
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

export default defineAction({
  description:
    "Ensure a recording has a transcript. Preserves native Web Speech/macOS Speech transcripts first, then uses configured backup transcription only when needed.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    force: z
      .boolean()
      .optional()
      .describe(
        "Bypass the recent pending guard for explicit retries or the finalize-recording background worker.",
      ),
  }),
  run: async (args) => {
    const db = getDb();
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
      })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    if (
      existingNativeTranscript?.status === "ready" &&
      existingNativeTranscript.fullText?.trim()
    ) {
      return completeReadyTranscript({
        db,
        recordingId: args.recordingId,
        ownerEmail,
        fullText: existingNativeTranscript.fullText,
        segmentsJson: existingNativeTranscript.segmentsJson,
      });
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
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "pending",
        failureReason: null,
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });

      const [rec] = await db
        .select({
          videoUrl: schema.recordings.videoUrl,
          videoFormat: schema.recordings.videoFormat,
          hasAudio: schema.recordings.hasAudio,
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
        });
      }

      try {
        const startedAt = Date.now();
        const builderResult = await transcribeWithBuilder({
          audioBytes: audioMedia.audioBytes,
          mimeType: audioMedia.mimeType,
          model: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
          diarize: false,
          instructions: SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS,
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

        const preserved = await preserveReadyTranscriptIfAvailable({
          db,
          recordingId: args.recordingId,
          ownerEmail,
        });
        if (preserved) return preserved;

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

        // Re-read title fresh — `rec.title` was fetched before the 30+ s
        // transcription and may be stale if the user renamed during that window.
        const [freshRec] = await db
          .select({
            title: schema.recordings.title,
            titleSource: schema.recordings.titleSource,
          })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);
        if (isAutoTitleReplaceable(freshRec?.title, freshRec?.titleSource)) {
          try {
            await regenerateTitle.run({ recordingId: args.recordingId });
          } catch (delegateErr) {
            console.warn(
              `[clips] auto-title delegation failed for ${args.recordingId}:`,
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
        if (reason.includes("credits exhausted")) {
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
          throw err;
        }
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
    await upsertTranscriptRow(db, {
      recordingId: args.recordingId,
      ownerEmail,
      status: "pending",
      failureReason: null,
      now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Load the recording's media URL and prepare audio-only bytes. We never
    // send video frames to a transcription provider; screen-only recordings
    // without speech should become an empty/no-speech transcript instead of a
    // visual narration.
    const [rec] = await db
      .select({
        videoUrl: schema.recordings.videoUrl,
        videoFormat: schema.recordings.videoFormat,
        hasAudio: schema.recordings.hasAudio,
        title: schema.recordings.title,
        titleSource: schema.recordings.titleSource,
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

      const preserved = await preserveReadyTranscriptIfAvailable({
        db,
        recordingId: args.recordingId,
        ownerEmail,
      });
      if (preserved) return preserved;

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

      // Auto-title. The clip was just born with the default title and we now
      // have a transcript to reason over — queue a delegation for the agent
      // chat to pick a concise title. `regenerate-title` writes a
      // `clips-ai-request-:id` application_state entry; the frontend bridge
      // picks that up and fires `sendToAgentChat` once. We intentionally skip
      // this when the user (or agent) has already renamed the clip so we never
      // clobber a human-authored title.
      if (isAutoTitleReplaceable(rec.title, rec.titleSource)) {
        try {
          await regenerateTitle.run({ recordingId: args.recordingId });
        } catch (delegateErr) {
          // Non-fatal — a missing delegation just means the clip keeps its
          // placeholder title until the user asks the agent to rename it.
          console.warn(
            `[clips] auto-title delegation failed for ${args.recordingId}:`,
            (delegateErr as Error).message,
          );
        }
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
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: reason,
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
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
  },
): Promise<void> {
  const [existing] = await db
    .select({ recordingId: schema.recordingTranscripts.recordingId })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, row.recordingId))
    .limit(1);

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
      createdAt: row.now,
      updatedAt: row.now,
    });
  }
}
