/**
 * Request a Whisper transcription for a recording.
 *
 * This is the ONE AI action that calls Whisper directly (transcription is a
 * data pipeline, not reasoning). Everything else — titles, summaries, chapters,
 * workflow docs — delegates to the agent chat.
 *
 * Provider selection:
 *   1. `GROQ_API_KEY` → Groq's `whisper-large-v3-turbo` (OpenAI-compatible API,
 *      typically 10-30x faster than OpenAI Whisper, ~$0.04/hour). **Preferred.**
 *   2. `OPENAI_API_KEY` → OpenAI's `whisper-1` (fallback, slower).
 *   3. Neither → fail with a clear reason.
 *
 * Both providers accept the same multipart form-data shape, so the only
 * differences are the endpoint URL and the `model` field.
 *
 * Hybrid transcription: the browser's Web Speech API runs during recording
 * and saves an instant transcript via `save-browser-transcript`. If this
 * action finds a browser transcript and no API key is configured, it
 * preserves the browser result instead of failing. When a key IS available,
 * Whisper refines the browser draft with higher-quality output.
 *
 * Fetches the recording's videoUrl, POSTs to the provider with
 * response_format=verbose_json and timestamp_granularities[]=segment, and
 * writes the result to `recording_transcripts` with status='ready'.
 *
 * Usage:
 *   pnpm action request-transcript --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { resolveCredential } from "@agent-native/core/credentials";
import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { hasBuilderPrivateKey } from "@agent-native/core/server";
import { transcribeWithBuilder } from "@agent-native/core/transcription/builder";
import regenerateTitle from "./regenerate-title.js";

/**
 * Default title seeded by `create-recording`. Used to detect "the user hasn't
 * set a title yet, so auto-generating one is safe." Any non-default title
 * means the user (or the agent) already renamed the clip and we must not
 * overwrite their choice.
 */
const DEFAULT_RECORDING_TITLE = "Untitled recording";

/** Treat blank / null / whitespace as "still the default". */
function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return true;
  return trimmed === DEFAULT_RECORDING_TITLE;
}

interface WhisperSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

interface WhisperResponse {
  text: string;
  language?: string;
  segments?: WhisperSegment[];
}

type TranscriptionProvider = {
  name: "groq" | "openai";
  endpoint: string;
  model: string;
  apiKey: string;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = "whisper-1";

/**
 * Resolve a secret from (in order):
 *   1. Per-user secret store (sidebar settings UI, encrypted at rest)
 *   2. `resolveCredential` (env + legacy settings prefix)
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
  const fromCreds = await resolveCredential(key);
  return fromCreds ?? undefined;
}

async function pickProvider(
  userEmail: string | null,
): Promise<TranscriptionProvider | null> {
  // Prefer Groq — same Whisper model family, ~10x faster, OpenAI-compatible.
  const groqKey = await resolveKey("GROQ_API_KEY", userEmail);
  if (groqKey) {
    return {
      name: "groq",
      endpoint: GROQ_ENDPOINT,
      model: GROQ_MODEL,
      apiKey: groqKey,
    };
  }
  const openaiKey = await resolveKey("OPENAI_API_KEY", userEmail);
  if (openaiKey) {
    return {
      name: "openai",
      endpoint: OPENAI_ENDPOINT,
      model: OPENAI_MODEL,
      apiKey: openaiKey,
    };
  }
  return null;
}

export default defineAction({
  description:
    "Generate a Whisper transcription for a recording. Prefers Groq whisper-large-v3-turbo (fast), falls back to OpenAI whisper-1. Fetches videoUrl, posts audio, writes segments + fullText to recording_transcripts.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    const userEmail = getRequestUserEmail() ?? ownerEmail;
    let builderError: string | null = null;

    // ── Builder transcription (highest priority) ──────────────────────
    // Builder proxy is available when BUILDER_PRIVATE_KEY is set. It
    // provides high-quality transcription without requiring a separate
    // Groq or OpenAI key.
    if (hasBuilderPrivateKey()) {
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
          title: schema.recordings.title,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId))
        .limit(1);
      if (!rec || !rec.videoUrl) {
        const reason = "Recording has no videoUrl";
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

      let videoBlob: Blob;
      try {
        const isLocalBlob =
          rec.videoUrl.startsWith("/api/video/") ||
          (rec.videoUrl.startsWith("/api/uploads/") &&
            rec.videoUrl.endsWith("/blob"));
        if (isLocalBlob) {
          const stash = await readAppState(
            `recording-blob-${args.recordingId}`,
          );
          const b64 = typeof stash?.data === "string" ? stash.data : null;
          if (!b64) throw new Error("recording-blob app-state missing");
          const bytes = Buffer.from(b64, "base64");
          const mime =
            typeof stash?.mimeType === "string" ? stash.mimeType : "video/webm";
          videoBlob = new Blob([bytes], { type: mime });
        } else {
          let videoUrl = rec.videoUrl;
          if (videoUrl.startsWith("/")) {
            const port = process.env.NITRO_PORT || process.env.PORT || "3000";
            const origin =
              process.env.PUBLIC_URL ??
              process.env.NITRO_PUBLIC_URL ??
              `http://localhost:${port}`;
            videoUrl = `${origin}${videoUrl}`;
          }
          const vidRes = await fetch(videoUrl);
          if (!vidRes.ok) {
            throw new Error(
              `Failed to fetch videoUrl: HTTP ${vidRes.status} ${vidRes.statusText}`,
            );
          }
          videoBlob = await vidRes.blob();
        }
      } catch (err) {
        const reason = `Failed to fetch video: ${(err as Error).message}`;
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

      try {
        const startedAt = Date.now();
        const audioBytes = new Uint8Array(await videoBlob.arrayBuffer());
        const mimeType = videoBlob.type || "video/webm";
        const builderResult = await transcribeWithBuilder({
          audioBytes,
          mimeType,
          diarize: false,
        });

        const segments = (builderResult.segments ?? []).map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text.trim(),
        }));

        await upsertTranscriptRow(db, {
          recordingId: args.recordingId,
          ownerEmail,
          status: "ready",
          failureReason: null,
          language: builderResult.language ?? "en",
          segmentsJson: JSON.stringify(segments),
          fullText: builderResult.text ?? "",
          now,
        });
        await writeAppState("refresh-signal", { ts: Date.now() });

        // Re-read title fresh — `rec.title` was fetched before the 30+ s
        // transcription and may be stale if the user renamed during that window.
        const [freshRec] = await db
          .select({ title: schema.recordings.title })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);
        if (isDefaultTitle(freshRec?.title)) {
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
          `Transcribed recording ${args.recordingId} via builder in ${elapsedMs}ms (${segments.length} segments)`,
        );
        return {
          recordingId: args.recordingId,
          status: "ready" as const,
          segments: segments.length,
          provider: "builder",
        };
      } catch (err) {
        const reason = (err as Error).message;
        if (reason.includes("credits exhausted")) {
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
          `[clips] Builder transcription failed for ${args.recordingId}; falling back to BYOK providers:`,
          reason,
        );
      }
    }

    // ── Groq / OpenAI fallback ────────────────────────────────────────
    // Resolve the provider BEFORE overwriting the transcript row — if no
    // key is configured but a browser-generated transcript already exists
    // (from Web Speech API during recording), preserve it instead of
    // clobbering it with "pending" then "failed".
    const provider = await pickProvider(userEmail);
    if (!provider) {
      const [existingRow] = await db
        .select({
          status: schema.recordingTranscripts.status,
          fullText: schema.recordingTranscripts.fullText,
        })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .limit(1);

      if (existingRow?.status === "ready" && existingRow.fullText?.trim()) {
        console.log(
          `[clips] No API key configured but browser transcript exists for ${args.recordingId} — keeping it`,
        );
        // Still queue a title-generation delegation — the browser transcript
        // is good enough for the agent to produce a real title even without
        // Whisper. This covers recordings where no API key is configured.
        const [recForTitle] = await db
          .select({ title: schema.recordings.title })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);
        if (recForTitle && isDefaultTitle(recForTitle.title)) {
          try {
            await regenerateTitle.run({ recordingId: args.recordingId });
          } catch (delegateErr) {
            console.warn(
              `[clips] auto-title delegation failed for ${args.recordingId}:`,
              (delegateErr as Error).message,
            );
          }
        }
        return {
          recordingId: args.recordingId,
          status: "ready" as const,
          provider: "browser",
        };
      }

      const reason = builderError
        ? `Builder transcription failed: ${builderError}. Add GROQ_API_KEY or OPENAI_API_KEY in Settings → API Keys to enable a fallback provider.`
        : "No transcription key configured. Set GROQ_API_KEY (fast) or OPENAI_API_KEY.";
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: reason,
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.error(`[clips] ${reason}`);
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

    // Load the recording's videoUrl.
    const [rec] = await db
      .select({
        videoUrl: schema.recordings.videoUrl,
        title: schema.recordings.title,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec || !rec.videoUrl) {
      const reason = "Recording has no videoUrl";
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

    // Resolve the video bytes. Two paths:
    //  1. Dev fallback — finalize-recording stashed the assembled blob in
    //     application_state under `recording-blob-:id`. Read it directly
    //     instead of round-tripping through HTTP (avoids the localhost-port
    //     guess and works under any port / host). Covers both the current
    //     `/api/video/:id` shape and the legacy `/api/uploads/:id/blob`.
    //  2. Production — videoUrl is an absolute URL on a real provider
    //     (Builder.io / R2 / S3). Fetch it normally.
    let videoBlob: Blob;
    try {
      const isLocalBlob =
        rec.videoUrl.startsWith("/api/video/") ||
        (rec.videoUrl.startsWith("/api/uploads/") &&
          rec.videoUrl.endsWith("/blob"));
      if (isLocalBlob) {
        const stash = await readAppState(`recording-blob-${args.recordingId}`);
        const b64 = typeof stash?.data === "string" ? stash.data : null;
        if (!b64) throw new Error("recording-blob app-state missing");
        const bytes = Buffer.from(b64, "base64");
        const mime =
          typeof stash?.mimeType === "string" ? stash.mimeType : "video/webm";
        videoBlob = new Blob([bytes], { type: mime });
      } else {
        let videoUrl = rec.videoUrl;
        if (videoUrl.startsWith("/")) {
          const port = process.env.NITRO_PORT || process.env.PORT || "3000";
          const origin =
            process.env.PUBLIC_URL ??
            process.env.NITRO_PUBLIC_URL ??
            `http://localhost:${port}`;
          videoUrl = `${origin}${videoUrl}`;
        }
        const vidRes = await fetch(videoUrl);
        if (!vidRes.ok) {
          throw new Error(
            `Failed to fetch videoUrl: HTTP ${vidRes.status} ${vidRes.statusText}`,
          );
        }
        videoBlob = await vidRes.blob();
      }
    } catch (err) {
      const reason = `Failed to fetch video: ${(err as Error).message}`;
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

    // Post to the provider. Groq and OpenAI accept the same form shape.
    const form = new FormData();
    form.append(
      "file",
      videoBlob,
      `${args.recordingId}.${videoBlob.type.includes("mp4") ? "mp4" : "webm"}`,
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
      const data = (await res.json()) as WhisperResponse;

      const segments = (data.segments ?? []).map((s) => ({
        startMs: Math.max(0, Math.round(s.start * 1000)),
        endMs: Math.max(0, Math.round(s.end * 1000)),
        text: s.text.trim(),
      }));

      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "ready",
        failureReason: null,
        language: data.language ?? "en",
        segmentsJson: JSON.stringify(segments),
        fullText: data.text ?? "",
        now,
      });

      await writeAppState("refresh-signal", { ts: Date.now() });

      // Auto-title. The clip was just born with the default title and we now
      // have a transcript to reason over — queue a delegation for the agent
      // chat to pick a concise 3-8 word title. `regenerate-title` writes a
      // `clips-ai-request-:id` application_state entry; the frontend bridge
      // in `_app.tsx` picks that up and fires `sendToAgentChat` once. We
      // intentionally skip this when the user (or agent) has already renamed
      // the clip so we never clobber a human-authored title.
      if (isDefaultTitle(rec.title)) {
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
        `Transcribed recording ${args.recordingId} via ${provider.name} (${provider.model}) in ${elapsedMs}ms (${segments.length} segments)`,
      );
      return {
        recordingId: args.recordingId,
        status: "ready" as const,
        segments: segments.length,
        provider: provider.name,
      };
    } catch (err) {
      const reason =
        (err as Error)?.name === "AbortError"
          ? `${provider.name} transcription timed out after 45 seconds.`
          : (err as Error).message;
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
