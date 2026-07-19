/**
 * Export Clips transcripts to Brain's signed ingest endpoint.
 *
 * Configure the destination with scoped credentials:
 *   - BRAIN_INGEST_URL: Brain generic ingest endpoint
 *   - BRAIN_INGEST_TOKEN: per-source bearer token
 */

import { defineAction } from "@agent-native/core";
import { resolveCredential } from "@agent-native/core/credentials";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  getAppProductionUrl,
  getCredentialContext,
} from "@agent-native/core/server";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";

const DEFAULT_LOOKBACK_DAYS = 28;
const DEFAULT_BACKFILL_LIMIT = 100;
const DEFAULT_CONCURRENCY = 4;

type Recording = typeof schema.recordings.$inferSelect;
type RecordingTranscript = typeof schema.recordingTranscripts.$inferSelect;

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
  sourceUrl: string;
  tags: string[];
  raw: Record<string, unknown>;
};

type BrainDestination = {
  ingestUrl: string;
  ingestToken: string;
};

type BackfillCursor = {
  version: 1;
  lookbackDays: number;
  since: string;
  until: string;
  afterCreatedAt: string;
  afterId: string;
};

type BrainExportResult =
  | {
      recordingId: string;
      status: "exported";
      captureId: string;
    }
  | {
      recordingId: string;
      status: "quarantined";
      sensitivityReceiptId: string;
      sensitivityDisposition: string;
    }
  | {
      recordingId: string;
      status: "skipped" | "failed";
      reason: string;
    };

const brainIngestResponseSchema = z
  .object({
    ok: z.boolean(),
    capture: z
      .object({
        id: z.string().min(1),
      })
      .passthrough()
      .nullable(),
    sensitivityReceipt: z
      .object({
        id: z.string().min(1),
        disposition: z.string().min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

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
  return new URL(
    `/r/${encodeURIComponent(id)}`,
    getAppProductionUrl(),
  ).toString();
}

function encodeBackfillCursor(cursor: BackfillCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeBackfillCursor(value: string): BackfillCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<BackfillCursor>;
    if (
      parsed.version !== 1 ||
      typeof parsed.lookbackDays !== "number" ||
      !Number.isInteger(parsed.lookbackDays) ||
      parsed.lookbackDays < 1 ||
      parsed.lookbackDays > 90 ||
      typeof parsed.since !== "string" ||
      !Number.isFinite(Date.parse(parsed.since)) ||
      typeof parsed.until !== "string" ||
      !Number.isFinite(Date.parse(parsed.until)) ||
      typeof parsed.afterCreatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.afterCreatedAt)) ||
      typeof parsed.afterId !== "string" ||
      !parsed.afterId
    ) {
      throw new Error("invalid cursor fields");
    }
    return parsed as BackfillCursor;
  } catch {
    throw new Error(
      "Invalid Clips Brain backfill cursor. Start a new backfill without cursor.",
    );
  }
}

async function resolveBrainDestination(): Promise<
  | { destination: BrainDestination; reason?: never }
  | { destination?: never; reason: string }
> {
  const credentialContext = getCredentialContext();
  if (!credentialContext) return { reason: "missing-request-context" };

  const ingestUrl = normalizeEndpoint(
    await resolveCredential("BRAIN_INGEST_URL", credentialContext),
  );
  if (!ingestUrl) return { reason: "missing-ingest-url" };

  const ingestToken = (
    await resolveCredential("BRAIN_INGEST_TOKEN", credentialContext)
  )?.trim();
  if (!ingestToken) return { reason: "missing-ingest-token" };

  return { destination: { ingestUrl, ingestToken } };
}

async function buildPayload(
  recording: Recording,
  transcript: RecordingTranscript,
): Promise<RawCapturePayload | null> {
  const segments = normalizeTranscriptSegments({
    segments: parseTranscriptSegments(transcript.segmentsJson),
    fullText: transcript.fullText,
    durationMs: recording.durationMs,
  });
  const transcriptText =
    transcript.fullText?.trim() ||
    segments
      .map((segment) => segment.text.trim())
      .join(" ")
      .trim();
  if (!transcriptText) return null;

  const db = getDb();
  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.recordingId, recording.id),
        accessFilter(schema.meetings, schema.meetingShares),
      ),
    )
    .limit(1);
  const [participants, tags] = await Promise.all([
    meeting
      ? db
          .select()
          .from(schema.meetingParticipants)
          .where(eq(schema.meetingParticipants.meetingId, meeting.id))
          .orderBy(asc(schema.meetingParticipants.createdAt))
      : Promise.resolve([]),
    db
      .select({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, recording.id))
      .orderBy(asc(schema.recordingTags.tag)),
  ]);

  return {
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
        status: transcript.status,
        language: transcript.language,
        updatedAt: transcript.updatedAt,
      },
    },
  };
}

export async function interpretBrainResponse(
  recordingId: string,
  response: Response,
): Promise<BrainExportResult> {
  if (!response.ok) {
    return {
      recordingId,
      status: "failed",
      reason: `brain-ingest-http-${response.status}`,
    };
  }

  const body = await response.json().catch(() => null);
  const parsed = brainIngestResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.ok) {
    return {
      recordingId,
      status: "failed",
      reason: "brain-ingest-invalid-response",
    };
  }
  if (parsed.data.capture) {
    return {
      recordingId,
      status: "exported",
      captureId: parsed.data.capture.id,
    };
  }
  if (parsed.data.sensitivityReceipt) {
    return {
      recordingId,
      status: "quarantined",
      sensitivityReceiptId: parsed.data.sensitivityReceipt.id,
      sensitivityDisposition: parsed.data.sensitivityReceipt.disposition,
    };
  }
  return {
    recordingId,
    status: "failed",
    reason: "brain-ingest-empty-response",
  };
}

async function exportRecording(
  recording: Recording,
  transcript: RecordingTranscript,
  destination: BrainDestination,
): Promise<BrainExportResult> {
  const payload = await buildPayload(recording, transcript);
  if (!payload) {
    return {
      recordingId: recording.id,
      status: "skipped",
      reason: "empty-transcript",
    };
  }

  try {
    const response = await ssrfSafeFetch(
      destination.ingestUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${destination.ingestToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
      { maxRedirects: 0 },
    );
    return interpretBrainResponse(recording.id, response);
  } catch (err) {
    const reason =
      (err as Error)?.name === "TimeoutError" ||
      (err as Error)?.name === "AbortError"
        ? "brain-ingest-timeout"
        : "brain-ingest-request-failed";
    console.warn("[clips] Brain export failed", {
      recordingId: recording.id,
      reason,
      error: (err as Error)?.message ?? String(err),
    });
    return { recordingId: recording.id, status: "failed", reason };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await map(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function backfillRecordings(
  destination: BrainDestination,
  options: {
    lookbackDays: number;
    limit: number;
    concurrency: number;
    cursor?: string;
  },
) {
  const ownerEmail = getCurrentOwnerEmail();
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) {
    throw new Error(
      "Select an organization before backfilling Clips to Brain.",
    );
  }

  const cursor = options.cursor ? decodeBackfillCursor(options.cursor) : null;
  const lookbackDays = cursor?.lookbackDays ?? options.lookbackDays;
  const until = cursor?.until ?? new Date().toISOString();
  const since =
    cursor?.since ??
    new Date(
      Date.parse(until) - lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  const continuation = cursor
    ? or(
        gt(schema.recordings.createdAt, cursor.afterCreatedAt),
        and(
          eq(schema.recordings.createdAt, cursor.afterCreatedAt),
          gt(schema.recordings.id, cursor.afterId),
        ),
      )
    : undefined;
  const rows = await getDb()
    .select({
      recording: schema.recordings,
      transcript: schema.recordingTranscripts,
    })
    .from(schema.recordings)
    .innerJoin(
      schema.recordingTranscripts,
      eq(schema.recordingTranscripts.recordingId, schema.recordings.id),
    )
    .where(
      and(
        accessFilter(schema.recordings, schema.recordingShares),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.organizationId, organizationId),
        isNull(schema.recordings.trashedAt),
        gte(schema.recordings.createdAt, since),
        lte(schema.recordings.createdAt, until),
        continuation,
        eq(schema.recordingTranscripts.status, "ready"),
        sql`TRIM(${schema.recordingTranscripts.fullText}) <> ''`,
      ),
    )
    .orderBy(asc(schema.recordings.createdAt), asc(schema.recordings.id))
    .limit(options.limit + 1);
  const truncated = rows.length > options.limit;
  const candidates = rows.slice(0, options.limit);
  const results = await mapWithConcurrency(
    candidates,
    options.concurrency,
    ({ recording, transcript }) =>
      exportRecording(recording, transcript, destination),
  );
  const lastCandidate = candidates[candidates.length - 1]?.recording;
  const nextCursor =
    truncated && lastCandidate
      ? encodeBackfillCursor({
          version: 1,
          lookbackDays,
          since,
          until,
          afterCreatedAt: lastCandidate.createdAt,
          afterId: lastCandidate.id,
        })
      : null;

  return {
    mode: "backfill" as const,
    organizationId,
    ownerEmail,
    since,
    until,
    lookbackDays,
    limit: options.limit,
    truncated,
    nextCursor,
    candidateCount: candidates.length,
    attempted: results.length,
    exported: results.filter((result) => result.status === "exported").length,
    quarantined: results.filter((result) => result.status === "quarantined")
      .length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export default defineAction({
  description:
    "Export one Clips recording transcript to Brain, or omit recordingId to backfill a bounded active-organization cohort with ready transcripts.",
  schema: z.object({
    recordingId: z
      .string()
      .min(1)
      .optional()
      .describe("One recording to export. Omit to run a bounded backfill."),
    lookbackDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .default(DEFAULT_LOOKBACK_DAYS),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(DEFAULT_BACKFILL_LIMIT),
    concurrency: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(DEFAULT_CONCURRENCY),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Stable continuation cursor returned by the previous backfill page.",
      ),
  }),
  run: async (args) => {
    if (args.recordingId) {
      const access = await assertAccess(
        "recording",
        args.recordingId,
        "editor",
      );
      const destinationResult = await resolveBrainDestination();
      if (!destinationResult.destination) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: destinationResult.reason,
        };
      }
      const [transcript] = await getDb()
        .select()
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .limit(1);
      if (!transcript) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "empty-transcript",
        };
      }
      return exportRecording(
        access.resource as Recording,
        transcript,
        destinationResult.destination,
      );
    }

    const destinationResult = await resolveBrainDestination();
    if (!destinationResult.destination) {
      return {
        mode: "backfill" as const,
        attempted: 0,
        exported: 0,
        quarantined: 0,
        skipped: 0,
        failed: 0,
        status: "skipped" as const,
        reason: destinationResult.reason,
        results: [],
      };
    }
    return backfillRecordings(destinationResult.destination, args);
  },
});
