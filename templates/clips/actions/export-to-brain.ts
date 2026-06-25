/**
 * Best-effort export of a Clips recording transcript to Brain.
 *
 * Configure the destination with scoped credentials:
 *   - BRAIN_INGEST_URL: Brain generic ingest endpoint
 *   - BRAIN_INGEST_TOKEN: optional bearer token
 *
 * This action never reads Brain data directly. It validates access to the
 * Clips recording, builds a RawCapturePayload, and posts it to Brain.
 */

import { defineAction } from "@agent-native/core";
import { resolveCredential } from "@agent-native/core/credentials";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";

type RawCapturePayload = {
  sourceKey: "clips";
  externalId: string;
  title: string;
  participants: Array<{
    email?: string;
    name?: string;
    role?: "organizer" | "participant";
  }>;
  occurredAt: string;
  transcript: string;
  segments: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
  sourceUrl: string | null;
  tags: string[];
  raw: Record<string, unknown>;
};

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeEndpoint(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resolveSourceUrl(id: string) {
  return `/r/${id}`;
}

export default defineAction({
  description:
    "Best-effort export of a Clips recording transcript and meeting metadata to a configured Brain generic ingest endpoint.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID to export to Brain"),
  }),
  run: async (args) => {
    const access = await assertAccess("recording", args.recordingId, "editor");
    const credentialContext = getCredentialContext();
    if (!credentialContext) {
      return {
        recordingId: args.recordingId,
        status: "skipped" as const,
        reason: "missing-request-context",
      };
    }

    const ingestUrl = normalizeEndpoint(
      await resolveCredential("BRAIN_INGEST_URL", credentialContext),
    );
    if (!ingestUrl) {
      return {
        recordingId: args.recordingId,
        status: "skipped" as const,
        reason: "not-configured",
      };
    }
    const ingestToken = await resolveCredential(
      "BRAIN_INGEST_TOKEN",
      credentialContext,
    );

    const db = getDb();
    const recording = access.resource as typeof schema.recordings.$inferSelect;
    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const segments = normalizeTranscriptSegments({
      segments: parseTranscriptSegments(transcript?.segmentsJson),
      fullText: transcript?.fullText,
      durationMs: recording.durationMs,
    });
    const transcriptText =
      transcript?.fullText?.trim() ||
      segments
        .map((segment) => segment.text.trim())
        .join(" ")
        .trim();
    if (!transcriptText) {
      return {
        recordingId: args.recordingId,
        status: "skipped" as const,
        reason: "empty-transcript",
      };
    }

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.recordingId, args.recordingId))
      .limit(1);
    const participants = meeting
      ? await db
          .select()
          .from(schema.meetingParticipants)
          .where(eq(schema.meetingParticipants.meetingId, meeting.id))
          .orderBy(asc(schema.meetingParticipants.createdAt))
      : [];
    const tags = await db
      .select({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, args.recordingId))
      .orderBy(asc(schema.recordingTags.tag));

    const payload: RawCapturePayload = {
      sourceKey: "clips",
      externalId: `clips:recording:${recording.id}`,
      title: meeting?.title || recording.title || "Untitled recording",
      participants: participants.map((participant) => ({
        email: participant.email || undefined,
        name: participant.name || undefined,
        role: participant.isOrganizer ? "organizer" : "participant",
      })),
      occurredAt:
        meeting?.actualStart ||
        meeting?.scheduledStart ||
        recording.createdAt ||
        new Date().toISOString(),
      transcript: transcriptText,
      segments,
      sourceUrl: resolveSourceUrl(recording.id),
      tags: tags.map((row) => row.tag).filter(Boolean),
      raw: {
        recording: {
          id: recording.id,
          organizationId: recording.organizationId,
          title: recording.title,
          description: recording.description,
          durationMs: recording.durationMs,
          createdAt: recording.createdAt,
          updatedAt: recording.updatedAt,
          sourceAppName: recording.sourceAppName,
          sourceWindowTitle: recording.sourceWindowTitle,
          spaceIds: safeJsonParse<string[]>(recording.spaceIds, []),
          chapters: safeJsonParse<Array<Record<string, unknown>>>(
            recording.chaptersJson,
            [],
          ),
        },
        meeting: meeting
          ? {
              id: meeting.id,
              title: meeting.title,
              platform: meeting.platform,
              source: meeting.source,
              scheduledStart: meeting.scheduledStart,
              scheduledEnd: meeting.scheduledEnd,
              actualStart: meeting.actualStart,
              actualEnd: meeting.actualEnd,
              joinUrl: meeting.joinUrl,
              calendarEventId: meeting.calendarEventId,
              summaryMd: meeting.summaryMd,
              bullets: safeJsonParse<Array<Record<string, unknown>>>(
                meeting.bulletsJson,
                [],
              ),
              actionItems: safeJsonParse<Array<Record<string, unknown>>>(
                meeting.actionItemsJson,
                [],
              ),
            }
          : null,
        transcript: {
          status: transcript?.status ?? null,
          language: transcript?.language ?? null,
          updatedAt: transcript?.updatedAt ?? null,
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ingestToken ? { authorization: `Bearer ${ingestToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn("[clips] Brain export failed", {
          recordingId: args.recordingId,
          status: response.status,
          statusText: response.statusText,
        });
        return {
          recordingId: args.recordingId,
          status: "failed" as const,
          reason: `brain-ingest-http-${response.status}`,
        };
      }
    } catch (err) {
      const reason =
        (err as Error)?.name === "AbortError"
          ? "brain-ingest-timeout"
          : "brain-ingest-request-failed";
      console.warn("[clips] Brain export failed", {
        recordingId: args.recordingId,
        reason,
        error: (err as Error)?.message ?? String(err),
      });
      return {
        recordingId: args.recordingId,
        status: "failed" as const,
        reason,
      };
    } finally {
      clearTimeout(timeout);
    }

    return {
      recordingId: args.recordingId,
      status: "exported" as const,
    };
  },
});
