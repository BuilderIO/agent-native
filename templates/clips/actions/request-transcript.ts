/**
 * Request a Whisper transcription for a recording.
 *
 * This is the ONE AI action that calls Whisper directly (transcription is a
 * data pipeline, not reasoning). Everything else — titles, summaries, chapters,
 * workflow docs — delegates to the agent chat.
 *
 * Fetches the recording's videoUrl, POSTs to OpenAI's Whisper endpoint with
 * response_format=verbose_json and timestamp_granularities[]=segment, and
 * writes the result to `recording_transcripts` with status='ready'.
 *
 * If `OPENAI_API_KEY` is missing, sets status='failed' with a helpful reason.
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

export default defineAction({
  description:
    "Generate a Whisper transcription for a recording. Fetches videoUrl, calls OpenAI Whisper API, and writes segments + fullText to recording_transcripts.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    // Upsert a pending row first so the UI can show "Transcribing…".
    await upsertTranscriptRow(db, {
      recordingId: args.recordingId,
      ownerEmail,
      status: "pending",
      failureReason: null,
      now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Resolve the API key. Prefer the `@agent-native/core/secrets` registry
    // (user-scoped, encrypted at rest, set via the sidebar settings UI), then
    // fall back to `resolveCredential` which checks env + the legacy settings
    // key prefix. That covers all three setups: local dev with .env, user
    // settings via the sidebar, and deployed environments with env vars.
    let apiKey: string | undefined;
    const userEmail = getRequestUserEmail() ?? ownerEmail;
    if (userEmail) {
      const userSecret = await readAppSecret({
        key: "OPENAI_API_KEY",
        scope: "user",
        scopeId: userEmail,
      }).catch(() => null);
      if (userSecret?.value) apiKey = userSecret.value;
    }
    if (!apiKey) {
      apiKey = await resolveCredential("OPENAI_API_KEY");
    }
    if (!apiKey) {
      await upsertTranscriptRow(db, {
        recordingId: args.recordingId,
        ownerEmail,
        status: "failed",
        failureReason: "OPENAI_API_KEY not configured",
        now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.error(
        "[clips] OPENAI_API_KEY not configured; transcript skipped.",
      );
      return {
        recordingId: args.recordingId,
        status: "failed" as const,
        failureReason: "OPENAI_API_KEY not configured",
      };
    }

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
    //     guess and works under any port / host).
    //  2. Production — videoUrl is an absolute URL on a real provider
    //     (Builder.io / R2 / S3). Fetch it normally.
    let videoBlob: Blob;
    try {
      const isLocalBlob =
        rec.videoUrl.startsWith("/api/uploads/") &&
        rec.videoUrl.endsWith("/blob");
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
          const origin =
            process.env.PUBLIC_URL ??
            process.env.NITRO_PUBLIC_URL ??
            `http://localhost:${process.env.PORT ?? 3000}`;
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

    // Post to Whisper.
    const form = new FormData();
    form.append(
      "file",
      videoBlob,
      `${args.recordingId}.${videoBlob.type.includes("mp4") ? "mp4" : "webm"}`,
    );
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    try {
      const res = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Whisper API error ${res.status}: ${text.slice(0, 300)}`,
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

      console.log(
        `Transcribed recording ${args.recordingId} (${segments.length} segments)`,
      );
      return {
        recordingId: args.recordingId,
        status: "ready" as const,
        segments: segments.length,
      };
    } catch (err) {
      const reason = (err as Error).message;
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
