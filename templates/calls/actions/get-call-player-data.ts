import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseSpaceIds, parseJson } from "../server/lib/calls.js";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Fetch everything the call page needs in a single response: the call row, transcript (segments + full text), summary, participants, tracker hits (with tracker metadata joined), tags, top 20 comments, and snippets on this call.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("call", args.callId);
    if (!access) {
      throw new ForbiddenError(`No access to call ${args.callId}`);
    }

    const db = getDb();
    const call: any = access.resource;

    const [transcript] = await db
      .select()
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    const [summary] = await db
      .select()
      .from(schema.callSummaries)
      .where(eq(schema.callSummaries.callId, args.callId))
      .limit(1);

    const participants = await db
      .select()
      .from(schema.callParticipants)
      .where(eq(schema.callParticipants.callId, args.callId))
      .orderBy(desc(schema.callParticipants.talkMs));

    const hitRows = await db
      .select({
        id: schema.trackerHits.id,
        trackerId: schema.trackerHits.trackerId,
        speakerLabel: schema.trackerHits.speakerLabel,
        segmentStartMs: schema.trackerHits.segmentStartMs,
        segmentEndMs: schema.trackerHits.segmentEndMs,
        quote: schema.trackerHits.quote,
        confidence: schema.trackerHits.confidence,
        createdAt: schema.trackerHits.createdAt,
        trackerName: schema.trackerDefinitions.name,
        trackerColor: schema.trackerDefinitions.color,
        trackerKind: schema.trackerDefinitions.kind,
      })
      .from(schema.trackerHits)
      .innerJoin(
        schema.trackerDefinitions,
        eq(schema.trackerHits.trackerId, schema.trackerDefinitions.id),
      )
      .where(eq(schema.trackerHits.callId, args.callId))
      .orderBy(asc(schema.trackerHits.segmentStartMs));

    const tags = await db
      .select({ tag: schema.callTags.tag })
      .from(schema.callTags)
      .where(eq(schema.callTags.callId, args.callId));

    const comments = await db
      .select()
      .from(schema.callComments)
      .where(eq(schema.callComments.callId, args.callId))
      .orderBy(
        asc(schema.callComments.videoTimestampMs),
        asc(schema.callComments.createdAt),
      )
      .limit(20);

    const snippetsOnCall = await db
      .select()
      .from(schema.snippets)
      .where(
        and(
          eq(schema.snippets.callId, args.callId),
          // trashedAt is nullable — omitting trashed snippets
        ),
      )
      .orderBy(asc(schema.snippets.startMs));
    const liveSnippets = snippetsOnCall.filter((s) => !s.trashedAt);

    const segments = parseJson<
      Array<{
        startMs: number;
        endMs: number;
        text: string;
        speakerLabel?: string;
      }>
    >(transcript?.segmentsJson, []);

    const mediaUrl = call.mediaUrl ?? null;

    return {
      role: access.role,
      call: {
        id: call.id,
        workspaceId: call.workspaceId,
        folderId: call.folderId,
        spaceIds: parseSpaceIds(call.spaceIds),
        title: call.title,
        description: call.description,
        accountId: call.accountId,
        dealStage: call.dealStage,
        thumbnailUrl: call.thumbnailUrl,
        durationMs: call.durationMs,
        mediaUrl,
        mediaKind: call.mediaKind,
        mediaFormat: call.mediaFormat,
        mediaSizeBytes: call.mediaSizeBytes,
        width: call.width,
        height: call.height,
        recordedAt: call.recordedAt,
        timezone: call.timezone,
        status: call.status,
        progressPct: call.progressPct,
        failureReason: call.failureReason,
        source: call.source,
        sourceMeta: parseJson<Record<string, unknown>>(call.sourceMeta, {}),
        password: call.password,
        expiresAt: call.expiresAt,
        shareIncludesSummary: Boolean(call.shareIncludesSummary),
        shareIncludesTranscript: Boolean(call.shareIncludesTranscript),
        enableComments: Boolean(call.enableComments),
        enableDownloads: Boolean(call.enableDownloads),
        defaultSpeed: call.defaultSpeed,
        visibility: call.visibility,
        ownerEmail: call.ownerEmail,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
        archivedAt: call.archivedAt,
        trashedAt: call.trashedAt,
      },
      transcript: transcript
        ? {
            status: transcript.status,
            language: transcript.language,
            provider: transcript.provider,
            fullText: transcript.fullText,
            failureReason: transcript.failureReason,
            segments,
          }
        : null,
      summary: summary
        ? {
            recap: summary.recap,
            keyPoints: parseJson<string[]>(summary.keyPointsJson, []),
            nextSteps: parseJson<string[]>(summary.nextStepsJson, []),
            topics: parseJson<string[]>(summary.topicsJson, []),
            questions: parseJson<string[]>(summary.questionsJson, []),
            actionItems: parseJson<unknown[]>(summary.actionItemsJson, []),
            sentiment: summary.sentiment,
            generatedBy: summary.generatedBy,
            generatedAt: summary.generatedAt,
            updatedAt: summary.updatedAt,
          }
        : null,
      participants: participants.map((p) => ({
        id: p.id,
        speakerLabel: p.speakerLabel,
        displayName: p.displayName,
        email: p.email,
        isInternal: Boolean(p.isInternal),
        avatarUrl: p.avatarUrl,
        color: p.color,
        talkMs: p.talkMs,
        talkPct: p.talkPct,
        longestMonologueMs: p.longestMonologueMs,
        interruptionsCount: p.interruptionsCount,
        questionsCount: p.questionsCount,
      })),
      trackerHits: hitRows.map((h) => ({
        id: h.id,
        trackerId: h.trackerId,
        trackerName: h.trackerName,
        trackerColor: h.trackerColor,
        trackerKind: h.trackerKind,
        speakerLabel: h.speakerLabel,
        segmentStartMs: h.segmentStartMs,
        segmentEndMs: h.segmentEndMs,
        quote: h.quote,
        confidence: h.confidence,
        createdAt: h.createdAt,
      })),
      tags: tags.map((t) => t.tag),
      comments: comments.map((c) => ({
        id: c.id,
        callId: c.callId,
        threadId: c.threadId,
        parentId: c.parentId,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
        content: c.content,
        videoTimestampMs: c.videoTimestampMs,
        emojiReactionsJson: c.emojiReactionsJson,
        resolved: Boolean(c.resolved),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      snippets: liveSnippets.map((s) => ({
        id: s.id,
        callId: s.callId,
        title: s.title,
        description: s.description,
        startMs: s.startMs,
        endMs: s.endMs,
        password: s.password,
        expiresAt: s.expiresAt,
        ownerEmail: s.ownerEmail,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  },
});
