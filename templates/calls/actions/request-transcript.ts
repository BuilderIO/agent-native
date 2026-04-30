/**
 * Kick off a Deepgram transcription for a call.
 *
 * This is the ONE AI operation that does NOT go through the agent chat —
 * transcription is a data pipeline, not reasoning. Everything else (summary,
 * topics, trackers, smart-tracker classification, snippet suggestions) is
 * delegated to the agent chat via application-state requests.
 *
 * Flow:
 *   1. Resolve DEEPGRAM_API_KEY (user-scoped secret first, then credentials)
 *   2. If no key but a browser transcript exists, preserve it and return early
 *   3. Upsert call_transcripts row with status="pending"
 *   4. Fetch media bytes (dev-fallback via app-state for /api/call-media/ urls)
 *   5. Call Deepgram -> labelSpeakers -> compute talk stats
 *   6. Upsert call_transcripts with status="ready"
 *   7. Materialize call_participants
 *   8. Set calls.status="analyzing"
 *   9. Queue agent delegations (summary / topics / trackers / suggest-snippets)
 *  10. Run keyword trackers synchronously
 *
 * Hybrid transcription: the browser's Web Speech API runs during recording
 * and saves an instant transcript via `save-browser-transcript`. If this
 * action finds a browser transcript and no API key is configured, it
 * preserves the browser result instead of failing. When a key IS available,
 * Deepgram refines the browser draft with higher-quality, diarized output.
 *
 * Usage:
 *   pnpm action request-transcript --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  colorForSpeaker,
  computeTalkStats,
  getCallOrThrow,
  getCurrentOwnerEmail,
  nanoid,
  parseJson,
} from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { resolveCredential } from "@agent-native/core/credentials";
import { readAppSecret } from "@agent-native/core/secrets";
import {
  getRequestUserEmail,
  getCredentialContext,
} from "@agent-native/core/server/request-context";
import { hasBuilderPrivateKey } from "@agent-native/core/server";
import { transcribeWithBuilder } from "@agent-native/core/transcription/builder";
import { transcribeWithDeepgram } from "../server/lib/transcription/deepgram.js";
import { labelSpeakers } from "../server/lib/transcription/diarize-speakers.js";
import type { TranscriptSegment } from "../shared/api.js";

export default defineAction({
  description:
    "Transcribe a call with Deepgram. Writes diarized segments to call_transcripts, materializes participants, sets call status to 'analyzing', and queues agent delegations for summary/topics/trackers/snippets. Keyword trackers run synchronously.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const nowIso = new Date().toISOString();
    const userEmail = getRequestUserEmail() ?? ownerEmail;

    // ── Builder transcription (highest priority) ──────────────────────
    // Builder proxy is available when BUILDER_PRIVATE_KEY is set. It
    // provides high-quality diarized transcription without requiring a
    // separate Deepgram key.
    if (hasBuilderPrivateKey()) {
      await upsertTranscriptRow(db, {
        callId: args.callId,
        ownerEmail,
        status: "pending",
        failureReason: null,
        now: nowIso,
      });
      await db
        .update(schema.calls)
        .set({ status: "transcribing", updatedAt: nowIso })
        .where(eq(schema.calls.id, args.callId));
      await writeAppState("refresh-signal", { ts: Date.now() });

      const call = await getCallOrThrow(args.callId);
      if (!call.mediaUrl) {
        await failTranscript(
          db,
          args.callId,
          ownerEmail,
          "Call has no mediaUrl",
          nowIso,
        );
        throw new Error("Call has no mediaUrl");
      }

      let audioBytes: Uint8Array;
      let mimeType: string;
      try {
        const isLocalBlob = call.mediaUrl.startsWith("/api/call-media/");
        if (isLocalBlob) {
          const stash = await readAppState(`call-blob-${args.callId}`);
          const b64 = typeof stash?.data === "string" ? stash.data : null;
          if (!b64)
            throw new Error("call-blob app-state missing for local media");
          audioBytes = new Uint8Array(Buffer.from(b64, "base64"));
          mimeType =
            typeof stash?.mimeType === "string" ? stash.mimeType : "audio/webm";
        } else if (call.mediaUrl.startsWith("/")) {
          const port = process.env.NITRO_PORT || process.env.PORT || "3000";
          const origin =
            process.env.PUBLIC_URL ??
            process.env.NITRO_PUBLIC_URL ??
            `http://localhost:${port}`;
          const absolute = `${origin}${call.mediaUrl}`;
          const res = await fetch(absolute);
          if (!res.ok) {
            throw new Error(
              `Failed to fetch mediaUrl: HTTP ${res.status} ${res.statusText}`,
            );
          }
          audioBytes = new Uint8Array(await res.arrayBuffer());
          mimeType = res.headers.get("content-type") ?? "audio/webm";
        } else {
          const res = await fetch(call.mediaUrl);
          if (!res.ok) {
            throw new Error(
              `Failed to fetch mediaUrl: HTTP ${res.status} ${res.statusText}`,
            );
          }
          audioBytes = new Uint8Array(await res.arrayBuffer());
          mimeType = res.headers.get("content-type") ?? "audio/webm";
        }
      } catch (err) {
        const reason = `Failed to resolve media: ${(err as Error).message}`;
        await failTranscript(db, args.callId, ownerEmail, reason, nowIso);
        throw new Error(reason);
      }

      try {
        const builderResult = await transcribeWithBuilder({
          audioBytes,
          mimeType,
          diarize: true,
          minSpeakers: 2,
          maxSpeakers: 6,
        });

        // Map Builder segments to the TranscriptSegment shape and
        // normalize speaker labels through the existing labelSpeakers().
        const rawSegments: TranscriptSegment[] = (
          builderResult.segments ?? []
        ).map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text.trim(),
          speakerLabel: s.speakerLabel ?? "Speaker 0",
          words: s.words,
        }));
        const segments = labelSpeakers(rawSegments);
        const fullText = builderResult.text ?? "";

        await upsertTranscriptRow(db, {
          callId: args.callId,
          ownerEmail,
          status: "ready",
          failureReason: null,
          language: builderResult.language || "en",
          provider: "deepgram", // Builder uses Deepgram under the hood
          segmentsJson: JSON.stringify(segments),
          fullText,
          now: nowIso,
        });

        await materializeParticipants(db, args.callId, segments);

        await db
          .update(schema.calls)
          .set({ status: "analyzing", updatedAt: nowIso })
          .where(eq(schema.calls.id, args.callId));

        const queueTasks = [
          "summary",
          "topics",
          "trackers",
          "suggest-snippets",
        ];
        await writeAppState(`call-ai-queue-${args.callId}`, {
          callId: args.callId,
          tasks: queueTasks,
          queuedAt: nowIso,
        });

        try {
          const { default: runTrackers } = await import("./run-trackers.js");
          await runTrackers.run({
            callId: args.callId,
            kind: "keyword",
          } as any);
        } catch (err) {
          console.error(
            `[calls] run-trackers failed for ${args.callId}:`,
            (err as Error).message,
          );
        }

        await writeAppState("refresh-signal", { ts: Date.now() });

        console.log(
          `Transcribed call ${args.callId} via builder (${segments.length} segments, ${builderResult.language})`,
        );
        return {
          callId: args.callId,
          status: "ready" as const,
          segments: segments.length,
          language: builderResult.language,
        };
      } catch (err) {
        const reason = (err as Error).message;
        await failTranscript(db, args.callId, ownerEmail, reason, nowIso);
        throw err;
      }
    }

    // ── Deepgram fallback ─────────────────────────────────────────────
    // Resolve the API key BEFORE overwriting the transcript row — if no
    // key is configured but a browser-generated transcript already exists
    // (from Web Speech API during recording), preserve it instead of
    // clobbering it with "pending" then "failed".
    let apiKey: string | undefined;
    if (userEmail) {
      const userSecret = await readAppSecret({
        key: "DEEPGRAM_API_KEY",
        scope: "user",
        scopeId: userEmail,
      }).catch(() => null);
      if (userSecret?.value) apiKey = userSecret.value;
    }
    if (!apiKey) {
      const credCtx = getCredentialContext();
      if (!credCtx) {
        throw new Error(
          "request-transcript: no active request context — cannot resolve DEEPGRAM_API_KEY safely.",
        );
      }
      apiKey = await resolveCredential("DEEPGRAM_API_KEY", credCtx);
    }
    if (!apiKey) {
      const [existingRow] = await db
        .select({
          status: schema.callTranscripts.status,
          fullText: schema.callTranscripts.fullText,
        })
        .from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.callId, args.callId))
        .limit(1);

      if (existingRow?.status === "ready" && existingRow.fullText?.trim()) {
        console.log(
          `[calls] No DEEPGRAM_API_KEY configured but browser transcript exists for ${args.callId} — keeping it`,
        );
        return {
          callId: args.callId,
          status: "ready" as const,
          provider: "browser",
        };
      }

      await failTranscript(
        db,
        args.callId,
        ownerEmail,
        "DEEPGRAM_API_KEY not configured",
        nowIso,
      );
      return {
        callId: args.callId,
        status: "failed" as const,
        failureReason: "DEEPGRAM_API_KEY not configured",
      };
    }

    await upsertTranscriptRow(db, {
      callId: args.callId,
      ownerEmail,
      status: "pending",
      failureReason: null,
      now: nowIso,
    });
    await db
      .update(schema.calls)
      .set({ status: "transcribing", updatedAt: nowIso })
      .where(eq(schema.calls.id, args.callId));
    await writeAppState("refresh-signal", { ts: Date.now() });

    const call = await getCallOrThrow(args.callId);
    if (!call.mediaUrl) {
      await failTranscript(
        db,
        args.callId,
        ownerEmail,
        "Call has no mediaUrl",
        nowIso,
      );
      throw new Error("Call has no mediaUrl");
    }

    let mediaBytes: Uint8Array | undefined;
    let mediaUrl: string | undefined;
    let mimeType: string | undefined;
    try {
      const isLocalBlob = call.mediaUrl.startsWith("/api/call-media/");
      if (isLocalBlob) {
        const stash = await readAppState(`call-blob-${args.callId}`);
        const b64 = typeof stash?.data === "string" ? stash.data : null;
        if (!b64)
          throw new Error("call-blob app-state missing for local media");
        mediaBytes = new Uint8Array(Buffer.from(b64, "base64"));
        mimeType =
          typeof stash?.mimeType === "string" ? stash.mimeType : undefined;
      } else if (call.mediaUrl.startsWith("/")) {
        const port = process.env.NITRO_PORT || process.env.PORT || "3000";
        const origin =
          process.env.PUBLIC_URL ??
          process.env.NITRO_PUBLIC_URL ??
          `http://localhost:${port}`;
        const absolute = `${origin}${call.mediaUrl}`;
        const res = await fetch(absolute);
        if (!res.ok) {
          throw new Error(
            `Failed to fetch mediaUrl: HTTP ${res.status} ${res.statusText}`,
          );
        }
        mediaBytes = new Uint8Array(await res.arrayBuffer());
        mimeType = res.headers.get("content-type") ?? undefined;
      } else {
        mediaUrl = call.mediaUrl;
      }
    } catch (err) {
      const reason = `Failed to resolve media: ${(err as Error).message}`;
      await failTranscript(db, args.callId, ownerEmail, reason, nowIso);
      throw new Error(reason);
    }

    let result;
    try {
      result = await transcribeWithDeepgram({
        apiKey,
        mediaUrl,
        mediaBytes,
        mimeType,
      });
    } catch (err) {
      const reason = (err as Error).message;
      await failTranscript(db, args.callId, ownerEmail, reason, nowIso);
      throw err;
    }

    const segments = labelSpeakers(result.segments);
    const fullText = result.fullText;

    await upsertTranscriptRow(db, {
      callId: args.callId,
      ownerEmail,
      status: "ready",
      failureReason: null,
      language: result.language || "en",
      provider: "deepgram",
      segmentsJson: JSON.stringify(segments),
      fullText,
      now: nowIso,
    });

    await materializeParticipants(db, args.callId, segments);

    await db
      .update(schema.calls)
      .set({ status: "analyzing", updatedAt: nowIso })
      .where(eq(schema.calls.id, args.callId));

    const queueTasks = ["summary", "topics", "trackers", "suggest-snippets"];
    await writeAppState(`call-ai-queue-${args.callId}`, {
      callId: args.callId,
      tasks: queueTasks,
      queuedAt: nowIso,
    });

    try {
      const { default: runTrackers } = await import("./run-trackers.js");
      await runTrackers.run({ callId: args.callId, kind: "keyword" } as any);
    } catch (err) {
      console.error(
        `[calls] run-trackers failed for ${args.callId}:`,
        (err as Error).message,
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Transcribed call ${args.callId} (${segments.length} segments, ${result.language})`,
    );
    return {
      callId: args.callId,
      status: "ready" as const,
      segments: segments.length,
      language: result.language,
    };
  },
});

async function upsertTranscriptRow(
  db: ReturnType<typeof getDb>,
  row: {
    callId: string;
    ownerEmail: string;
    status: "pending" | "ready" | "failed";
    failureReason: string | null;
    language?: string;
    provider?: "deepgram" | "assemblyai" | "whisper";
    segmentsJson?: string;
    fullText?: string;
    now: string;
  },
): Promise<void> {
  const [existing] = await db
    .select({ callId: schema.callTranscripts.callId })
    .from(schema.callTranscripts)
    .where(eq(schema.callTranscripts.callId, row.callId))
    .limit(1);
  if (existing) {
    await db
      .update(schema.callTranscripts)
      .set({
        ownerEmail: row.ownerEmail,
        status: row.status,
        failureReason: row.failureReason,
        ...(row.language ? { language: row.language } : {}),
        ...(row.provider ? { provider: row.provider } : {}),
        ...(row.segmentsJson ? { segmentsJson: row.segmentsJson } : {}),
        ...(row.fullText !== undefined ? { fullText: row.fullText } : {}),
        updatedAt: row.now,
      })
      .where(eq(schema.callTranscripts.callId, row.callId));
  } else {
    await db.insert(schema.callTranscripts).values({
      callId: row.callId,
      ownerEmail: row.ownerEmail,
      language: row.language ?? "en",
      provider: row.provider ?? "deepgram",
      segmentsJson: row.segmentsJson ?? "[]",
      fullText: row.fullText ?? "",
      status: row.status,
      failureReason: row.failureReason,
      createdAt: row.now,
      updatedAt: row.now,
    });
  }
}

async function failTranscript(
  db: ReturnType<typeof getDb>,
  callId: string,
  ownerEmail: string,
  reason: string,
  nowIso: string,
): Promise<void> {
  await upsertTranscriptRow(db, {
    callId,
    ownerEmail,
    status: "failed",
    failureReason: reason,
    now: nowIso,
  });
  await db
    .update(schema.calls)
    .set({ status: "failed", failureReason: reason, updatedAt: nowIso })
    .where(eq(schema.calls.id, callId));
  await writeAppState("refresh-signal", { ts: Date.now() });
  console.error(`[calls] request-transcript failed for ${callId}: ${reason}`);
}

async function materializeParticipants(
  db: ReturnType<typeof getDb>,
  callId: string,
  segments: TranscriptSegment[],
): Promise<void> {
  const stats = computeTalkStats(segments);

  const existing = await db
    .select()
    .from(schema.callParticipants)
    .where(eq(schema.callParticipants.callId, callId));
  const existingByLabel = new Map(
    existing.map((r) => [r.speakerLabel, r] as const),
  );

  const nowIso = new Date().toISOString();
  for (const p of stats.participants) {
    const prior = existingByLabel.get(p.speakerLabel);
    if (prior) {
      await db
        .update(schema.callParticipants)
        .set({
          talkMs: p.talkMs,
          talkPct: p.talkPct,
          longestMonologueMs: p.longestMonologueMs,
          interruptionsCount: p.interruptionsCount,
          questionsCount: p.questionsCount,
        })
        .where(eq(schema.callParticipants.id, prior.id));
    } else {
      await db.insert(schema.callParticipants).values({
        id: nanoid(),
        callId,
        speakerLabel: p.speakerLabel,
        color: colorForSpeaker(p.speakerLabel),
        talkMs: p.talkMs,
        talkPct: p.talkPct,
        longestMonologueMs: p.longestMonologueMs,
        interruptionsCount: p.interruptionsCount,
        questionsCount: p.questionsCount,
        createdAt: nowIso,
      });
    }
  }

  const seenLabels = new Set(stats.participants.map((p) => p.speakerLabel));
  for (const row of existing) {
    if (!seenLabels.has(row.speakerLabel)) {
      await db
        .delete(schema.callParticipants)
        .where(
          and(
            eq(schema.callParticipants.callId, callId),
            eq(schema.callParticipants.id, row.id),
          ),
        );
    }
  }
}

export { upsertTranscriptRow };

// Tree-shake guard
void parseJson;
