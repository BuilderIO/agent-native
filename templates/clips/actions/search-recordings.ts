import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

const SNIPPET_RADIUS = 80;

type RecordingMatchPanel = "transcript" | "comments" | null;

function playerPath(
  recordingId: string,
  options: { matchMs?: number | null; matchPanel?: RecordingMatchPanel } = {},
): string {
  const params = new URLSearchParams();
  if (typeof options.matchMs === "number" && Number.isFinite(options.matchMs)) {
    params.set("t", Math.max(0, Math.floor(options.matchMs / 1000)).toString());
  }
  if (options.matchPanel) params.set("panel", options.matchPanel);
  const query = params.toString();
  return `/r/${encodeURIComponent(recordingId)}${query ? `?${query}` : ""}`;
}

function recordingDeepLink(
  recordingId: string,
  options: { matchMs?: number | null; matchPanel?: RecordingMatchPanel } = {},
): string {
  return buildDeepLink({
    app: "clips",
    view: "recording",
    params: {
      recordingId,
      ...(typeof options.matchMs === "number" &&
      Number.isFinite(options.matchMs)
        ? { t: Math.max(0, Math.floor(options.matchMs / 1000)) }
        : {}),
      ...(options.matchPanel ? { panel: options.matchPanel } : {}),
    },
    to: playerPath(recordingId, options),
  });
}

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

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

function parseSegments(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((seg) => ({
        startMs: Number(seg?.startMs ?? 0),
        endMs: Number(seg?.endMs ?? seg?.startMs ?? 0),
        text: String(seg?.text ?? ""),
      }))
      .filter((seg) => Number.isFinite(seg.startMs) && seg.text.trim());
  } catch {
    return [];
  }
}

function transcriptMatch(
  fullText: string,
  segmentsJson: string | null | undefined,
  query: string,
): { snippet: string | null; matchMs: number | null } {
  const q = query.toLowerCase();
  for (const segment of parseSegments(segmentsJson)) {
    if (segment.text.toLowerCase().includes(q)) {
      return {
        snippet: buildSnippet(segment.text, query) ?? segment.text,
        matchMs: Math.max(0, Math.floor(segment.startMs)),
      };
    }
  }

  return { snippet: buildSnippet(fullText, query), matchMs: null };
}

export default defineAction({
  description:
    "Search recordings by title, description, transcript text, or comments. Transcript and comment matches include timestamps for jumping to the matching moment.",
  schema: z.object({
    query: z.string().min(1).describe("Search text"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Clip search",
      description: "Open the best matching recording in the real Clips player.",
      iframeTitle: "Agent-Native Clips",
      openLabel: "Open clip",
      height: 680,
    }),
  },
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const pattern = `%${escapeLike(args.query)}%`;

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
          sql`(${schema.recordings.title} LIKE ${pattern} ESCAPE '\\' OR ${schema.recordings.description} LIKE ${pattern} ESCAPE '\\')`,
        ),
      )
      .limit(args.limit);

    // Transcript matches — join recordings so accessFilter is applied upfront,
    // preventing cross-user transcript ID leakage via timing side-channels.
    const transcriptRows = await db
      .select({
        recordingId: schema.recordingTranscripts.recordingId,
        fullText: schema.recordingTranscripts.fullText,
        segmentsJson: schema.recordingTranscripts.segmentsJson,
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
      .from(schema.recordingTranscripts)
      .innerJoin(
        schema.recordings,
        eq(schema.recordingTranscripts.recordingId, schema.recordings.id),
      )
      .where(
        and(
          accessFilter(schema.recordings, schema.recordingShares),
          sql`${schema.recordingTranscripts.fullText} LIKE ${pattern} ESCAPE '\\'`,
        ),
      )
      .limit(args.limit);

    const commentRows = await db
      .select({
        recordingId: schema.recordingComments.recordingId,
        content: schema.recordingComments.content,
        videoTimestampMs: schema.recordingComments.videoTimestampMs,
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
      .from(schema.recordingComments)
      .innerJoin(
        schema.recordings,
        eq(schema.recordingComments.recordingId, schema.recordings.id),
      )
      .where(
        and(
          accessFilter(schema.recordings, schema.recordingShares),
          sql`${schema.recordingComments.content} LIKE ${pattern} ESCAPE '\\'`,
        ),
      )
      .limit(args.limit);

    const transcriptMatches = transcriptRows.map((r) => ({
      recordingId: r.recordingId,
      ...transcriptMatch(r.fullText, r.segmentsJson, args.query),
    }));
    const transcriptRecordings = transcriptRows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      thumbnailUrl: r.thumbnailUrl,
      durationMs: r.durationMs,
      ownerEmail: r.ownerEmail,
      visibility: r.visibility,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    const commentRecordings = commentRows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      thumbnailUrl: r.thumbnailUrl,
      durationMs: r.durationMs,
      ownerEmail: r.ownerEmail,
      visibility: r.visibility,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      snippet: buildSnippet(r.content, args.query) ?? r.content,
      matchMs: Math.max(0, Math.floor(r.videoTimestampMs ?? 0)),
    }));

    // Merge matches by id. Prefer transcript snippet if present.
    const transcriptById = new Map<
      string,
      { snippet: string | null; matchMs: number | null }
    >();
    for (const t of transcriptMatches) {
      if (t.recordingId) {
        transcriptById.set(t.recordingId, {
          snippet: t.snippet,
          matchMs: t.matchMs,
        });
      }
    }

    const merged = new Map<string, any>();
    for (const r of recMatches) {
      merged.set(r.id, {
        ...r,
        matchType: "title-description",
        snippet: buildSnippet(r.description, args.query),
        matchMs: null,
        matchPanel: null,
      });
    }
    for (const r of transcriptRecordings) {
      const existing = merged.get(r.id);
      const match = transcriptById.get(r.id);
      const snippet = match?.snippet ?? null;
      if (existing) {
        existing.matchType = "title-transcript";
        existing.snippet = snippet;
        existing.matchMs = match?.matchMs ?? null;
        existing.matchPanel = "transcript";
      } else {
        merged.set(r.id, {
          ...r,
          matchType: "transcript",
          snippet,
          matchMs: match?.matchMs ?? null,
          matchPanel: "transcript",
        });
      }
    }
    for (const r of commentRecordings) {
      const existing = merged.get(r.id);
      if (existing) {
        if (existing.matchPanel !== "transcript") {
          existing.matchType =
            existing.matchType === "title-description"
              ? "title-comment"
              : "comment";
          existing.snippet = r.snippet;
          existing.matchMs = r.matchMs;
          existing.matchPanel = "comments";
        }
      } else {
        merged.set(r.id, {
          ...r,
          matchType: "comment",
          matchPanel: "comments",
        });
      }
    }

    const results = Array.from(merged.values()).sort((a, b) => {
      // Metadata matches first, then timed transcript/comment content.
      const order = {
        "title-description": 0,
        "title-transcript": 1,
        "title-comment": 2,
        transcript: 3,
        comment: 4,
      } as const;
      const oa = order[a.matchType as keyof typeof order] ?? 5;
      const ob = order[b.matchType as keyof typeof order] ?? 5;
      if (oa !== ob) return oa - ob;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });

    return {
      query: args.query,
      results: results.slice(0, args.limit),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const results = (result as { results?: unknown }).results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const first = results[0] as {
      id?: string;
      matchMs?: number | null;
      matchPanel?: RecordingMatchPanel;
    };
    if (!first.id) return null;
    return {
      url: recordingDeepLink(first.id, {
        matchMs: first.matchMs,
        matchPanel: first.matchPanel ?? null,
      }),
      label: "Open clip in Clips",
      view: "recording",
    };
  },
});
