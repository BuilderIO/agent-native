import { defineAction } from "@agent-native/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

const SNIPPET_RADIUS = 80;

function buildSnippet(fullText: string, query: string): string | null {
  if (!fullText || !query) return null;
  const lower = fullText.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(fullText.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < fullText.length ? "…" : "";
  return `${prefix}${fullText.slice(start, end)}${suffix}`;
}

export default defineAction({
  description:
    "Search recordings by title, description, or transcript text. Returns matches with a highlighted transcript snippet.",
  schema: z.object({
    query: z.string().min(1).describe("Search text"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const pattern = `%${args.query}%`;

    // Title/description matches on the recordings table
    const recMatches = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        description: schema.recordings.description,
        thumbnailUrl: schema.recordings.thumbnailUrl,
        durationMs: schema.recordings.durationMs,
        ownerEmail: schema.recordings.ownerEmail,
        visibility: schema.recordings.visibility,
        createdAt: schema.recordings.createdAt,
        updatedAt: schema.recordings.updatedAt,
      })
      .from(schema.recordings)
      .where(
        and(
          accessFilter(schema.recordings, schema.recordingShares),
          sql`(${schema.recordings.title} LIKE ${pattern} OR ${schema.recordings.description} LIKE ${pattern})`,
        ),
      )
      .limit(args.limit);

    // Transcript matches on recording_transcripts.fullText
    const transcriptMatches = await db
      .select({
        recordingId: schema.recordingTranscripts.recordingId,
        fullText: schema.recordingTranscripts.fullText,
      })
      .from(schema.recordingTranscripts)
      .where(sql`${schema.recordingTranscripts.fullText} LIKE ${pattern}`)
      .limit(args.limit);

    const transcriptIds = transcriptMatches
      .map((t) => t.recordingId)
      .filter((id): id is string => !!id);

    let transcriptRecordings: any[] = [];
    if (transcriptIds.length > 0) {
      transcriptRecordings = await db
        .select({
          id: schema.recordings.id,
          title: schema.recordings.title,
          description: schema.recordings.description,
          thumbnailUrl: schema.recordings.thumbnailUrl,
          durationMs: schema.recordings.durationMs,
          ownerEmail: schema.recordings.ownerEmail,
          visibility: schema.recordings.visibility,
          createdAt: schema.recordings.createdAt,
          updatedAt: schema.recordings.updatedAt,
        })
        .from(schema.recordings)
        .where(
          and(
            accessFilter(schema.recordings, schema.recordingShares),
            inArray(schema.recordings.id, transcriptIds),
          ),
        );
    }

    // Merge matches by id. Prefer transcript snippet if present.
    const snippetById = new Map<string, string | null>();
    for (const t of transcriptMatches) {
      if (t.recordingId && t.fullText) {
        snippetById.set(t.recordingId, buildSnippet(t.fullText, args.query));
      }
    }

    const merged = new Map<string, any>();
    for (const r of recMatches) {
      merged.set(r.id, { ...r, matchType: "title-description", snippet: null });
    }
    for (const r of transcriptRecordings) {
      const existing = merged.get(r.id);
      const snippet = snippetById.get(r.id) ?? null;
      if (existing) {
        existing.matchType = "title-transcript";
        existing.snippet = snippet;
      } else {
        merged.set(r.id, { ...r, matchType: "transcript", snippet });
      }
    }

    const results = Array.from(merged.values()).sort((a, b) => {
      // Title matches first, then transcript
      const order = {
        "title-description": 0,
        "title-transcript": 1,
        transcript: 2,
      } as const;
      const oa = order[a.matchType as keyof typeof order] ?? 3;
      const ob = order[b.matchType as keyof typeof order] ?? 3;
      if (oa !== ob) return oa - ob;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });

    return {
      query: args.query,
      results: results.slice(0, args.limit),
    };
  },
});
