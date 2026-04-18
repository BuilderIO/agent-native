import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import {
  applySearchWhere,
  buildSearchTerms,
  buildSnippet,
} from "../server/lib/search/fts.js";

export default defineAction({
  description:
    "Search calls across title, description, and transcripts. Supports +required, -excluded, and \"quoted phrases\". Returns the matching calls with a highlight snippet drawn from the transcript (or description) where applicable.",
  schema: z.object({
    query: z.string().min(1).describe("Search text"),
    limit: z.coerce.number().int().min(1).max(200).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const where = applySearchWhere(
      args.query,
      schema.calls.title,
      schema.calls.description,
      schema.callTranscripts.fullText,
    );

    if (!where) {
      return { query: args.query, results: [] };
    }

    // Core select: calls left joined with transcripts so the WHERE can reach
    // full_text without dropping non-transcribed calls.
    const rows = await db
      .select({
        id: schema.calls.id,
        title: schema.calls.title,
        description: schema.calls.description,
        thumbnailUrl: schema.calls.thumbnailUrl,
        durationMs: schema.calls.durationMs,
        ownerEmail: schema.calls.ownerEmail,
        createdAt: schema.calls.createdAt,
        updatedAt: schema.calls.updatedAt,
        mediaKind: schema.calls.mediaKind,
        recordedAt: schema.calls.recordedAt,
        accountId: schema.calls.accountId,
        status: schema.calls.status,
      })
      .from(schema.calls)
      .leftJoin(
        schema.callTranscripts,
        eq(schema.calls.id, schema.callTranscripts.callId),
      )
      .where(and(accessFilter(schema.calls, schema.callShares), where))
      .orderBy(desc(schema.calls.updatedAt))
      .limit(args.limit)
      .offset(args.offset);

    const dedupeIds = Array.from(new Set(rows.map((r) => r.id)));
    if (!dedupeIds.length) return { query: args.query, results: [] };

    const transcripts = await db
      .select({
        callId: schema.callTranscripts.callId,
        fullText: schema.callTranscripts.fullText,
      })
      .from(schema.callTranscripts)
      .where(inArray(schema.callTranscripts.callId, dedupeIds));
    const fullTextById = new Map(
      transcripts.map((t) => [t.callId, t.fullText] as const),
    );

    const terms = buildSearchTerms(args.query);
    const allTerms = [...terms.phrases, ...terms.positive];
    const primary = allTerms[0] ?? args.query;

    const seen = new Set<string>();
    const results: any[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const transcriptText = fullTextById.get(r.id) ?? "";
      const highlight =
        buildSnippet(transcriptText, primary) ||
        buildSnippet(r.description, primary) ||
        buildSnippet(r.title, primary);
      results.push({
        id: r.id,
        title: r.title,
        description: r.description,
        thumbnailUrl: r.thumbnailUrl,
        durationMs: r.durationMs,
        ownerEmail: r.ownerEmail,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        mediaKind: r.mediaKind,
        recordedAt: r.recordedAt,
        accountId: r.accountId,
        status: r.status,
        highlight,
      });
    }

    return { query: args.query, results };
  },
});
