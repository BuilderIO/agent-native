import { defineAction } from "@agent-native/core";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { parseSpaceIds } from "../server/lib/calls.js";

export default defineAction({
  description:
    "List calls visible to the current user. Supports filtering by view (library/archive/trash/all), folder, space, search, tag, account, tracker, source, participant email, and sort.",
  schema: z.object({
    view: z
      .enum(["library", "archive", "trash", "all"])
      .default("library")
      .describe("Which list to show"),
    folderId: z
      .string()
      .nullish()
      .describe("Folder id (null = root). Only applies to library view."),
    spaceId: z
      .string()
      .nullish()
      .describe("Space id — matches calls whose space_ids array contains it"),
    search: z
      .string()
      .nullish()
      .describe("Title / description substring match"),
    tag: z.string().nullish().describe("Filter to calls carrying this tag"),
    accountId: z
      .string()
      .nullish()
      .describe("Filter to calls tied to this account"),
    trackerId: z
      .string()
      .nullish()
      .describe("Filter to calls with at least one hit for this tracker"),
    trackerIds: z
      .array(z.string())
      .nullish()
      .describe("Filter to calls with at least one hit for any tracker"),
    source: z
      .enum(["upload", "browser", "recall-bot", "zoom-cloud"])
      .nullish()
      .describe("Filter by capture origin"),
    dateFrom: z.string().nullish().describe("Recorded/created lower bound"),
    dateTo: z.string().nullish().describe("Recorded/created upper bound"),
    durationMinMs: z.coerce
      .number()
      .int()
      .min(0)
      .nullish()
      .describe("Minimum call duration"),
    durationMaxMs: z.coerce
      .number()
      .int()
      .min(0)
      .nullish()
      .describe("Maximum call duration"),
    internalOnly: z
      .boolean()
      .nullish()
      .describe("Only calls with an internal participant"),
    participantEmail: z
      .string()
      .nullish()
      .describe("Filter to calls including this participant email"),
    participantEmails: z
      .array(z.string())
      .nullish()
      .describe("Filter to calls including any of these participant emails"),
    sort: z
      .enum(["recent", "oldest", "longest", "most-viewed", "title"])
      .default("recent")
      .describe("Sort order"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const whereClauses = [accessFilter(schema.calls, schema.callShares)];

    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.calls.trashedAt));
    } else {
      whereClauses.push(isNull(schema.calls.trashedAt));
      if (args.view === "archive") {
        whereClauses.push(isNotNull(schema.calls.archivedAt));
      } else if (args.view !== "all") {
        whereClauses.push(isNull(schema.calls.archivedAt));
      }
    }

    if (args.view === "library") {
      if (args.folderId !== undefined && args.folderId !== null) {
        whereClauses.push(eq(schema.calls.folderId, args.folderId));
      } else if (args.folderId === null) {
        whereClauses.push(isNull(schema.calls.folderId));
      }
    }

    if (args.spaceId) {
      const needle = `%"${args.spaceId.replace(/%/g, "")}"%`;
      whereClauses.push(sql`${schema.calls.spaceIds} LIKE ${needle}`);
    }

    if (args.search) {
      const pat = `%${args.search}%`;
      whereClauses.push(
        sql`(${schema.calls.title} LIKE ${pat} OR ${schema.calls.description} LIKE ${pat})`,
      );
    }

    if (args.accountId) {
      whereClauses.push(eq(schema.calls.accountId, args.accountId));
    }

    if (args.source) {
      whereClauses.push(eq(schema.calls.source, args.source));
    }

    if (args.dateFrom) {
      whereClauses.push(gte(schema.calls.createdAt, args.dateFrom));
    }

    if (args.dateTo) {
      whereClauses.push(lte(schema.calls.createdAt, args.dateTo));
    }

    if (args.durationMinMs != null) {
      whereClauses.push(gte(schema.calls.durationMs, args.durationMinMs));
    }

    if (args.durationMaxMs != null) {
      whereClauses.push(lte(schema.calls.durationMs, args.durationMaxMs));
    }

    if (args.tag) {
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.callTags} ct WHERE ct.call_id = ${schema.calls.id} AND ct.tag = ${args.tag})`,
      );
    }

    const trackerIds = [
      ...(args.trackerId ? [args.trackerId] : []),
      ...(args.trackerIds ?? []),
    ].filter((id): id is string => Boolean(id));

    if (trackerIds.length) {
      const trackerIdList = sql.join(
        trackerIds.map((id) => sql`${id}`),
        sql`, `,
      );
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.trackerHits} th WHERE th.call_id = ${schema.calls.id} AND th.tracker_id IN (${trackerIdList}))`,
      );
    }

    const participantEmails = [
      ...(args.participantEmail ? [args.participantEmail] : []),
      ...(args.participantEmails ?? []),
    ].filter((email): email is string => Boolean(email));

    if (participantEmails.length) {
      const participantEmailList = sql.join(
        participantEmails.map((email) => sql`${email}`),
        sql`, `,
      );
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.callParticipants} cp WHERE cp.call_id = ${schema.calls.id} AND cp.email IN (${participantEmailList}))`,
      );
    }

    if (args.internalOnly) {
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.callParticipants} cp WHERE cp.call_id = ${schema.calls.id} AND cp.is_internal = 1)`,
      );
    }

    const orderBy =
      args.sort === "oldest"
        ? asc(schema.calls.createdAt)
      : args.sort === "longest"
        ? desc(schema.calls.durationMs)
        : args.sort === "title"
          ? asc(schema.calls.title)
        : args.sort === "most-viewed"
          ? sql`(SELECT COUNT(1) FROM ${schema.callViewers} cv WHERE cv.call_id = ${schema.calls.id} AND cv.counted_view = 1) DESC, ${schema.calls.createdAt} DESC`
          : desc(schema.calls.createdAt);

    const rows = await db
      .select()
      .from(schema.calls)
      .where(and(...whereClauses))
      .orderBy(orderBy)
      .limit(args.limit)
      .offset(args.offset);

    const ids = rows.map((r) => r.id);

    const tagsByCall: Record<string, string[]> = {};
    const viewsByCall: Record<string, number> = {};
    const participantsByCall: Record<
      string,
      Array<{
        speakerLabel: string;
        displayName: string | null;
        talkPct: number;
      }>
    > = {};
    const trackerHitsByCall: Record<
      string,
      Array<{
        trackerId: string;
        name: string;
        color: string;
        hitCount: number;
      }>
    > = {};

    if (ids.length) {
      const tagRows = await db
        .select()
        .from(schema.callTags)
        .where(inArray(schema.callTags.callId, ids));
      for (const t of tagRows) {
        (tagsByCall[t.callId] ??= []).push(t.tag);
      }

      const viewRows = await db
        .select({
          callId: schema.callViewers.callId,
          count: sql<number>`COUNT(1)`,
        })
        .from(schema.callViewers)
        .where(
          and(
            inArray(schema.callViewers.callId, ids),
            eq(schema.callViewers.countedView, true),
          ),
        )
        .groupBy(schema.callViewers.callId);
      for (const v of viewRows) {
        viewsByCall[v.callId] = Number(v.count ?? 0);
      }

      const participantRows = await db
        .select({
          callId: schema.callParticipants.callId,
          speakerLabel: schema.callParticipants.speakerLabel,
          displayName: schema.callParticipants.displayName,
          talkPct: schema.callParticipants.talkPct,
        })
        .from(schema.callParticipants)
        .where(inArray(schema.callParticipants.callId, ids));
      for (const p of participantRows) {
        (participantsByCall[p.callId] ??= []).push({
          speakerLabel: p.speakerLabel,
          displayName: p.displayName,
          talkPct: p.talkPct,
        });
      }

      const hitGroups = await db
        .select({
          callId: schema.trackerHits.callId,
          trackerId: schema.trackerHits.trackerId,
          name: schema.trackerDefinitions.name,
          color: schema.trackerDefinitions.color,
          hitCount: sql<number>`COUNT(1)`,
        })
        .from(schema.trackerHits)
        .innerJoin(
          schema.trackerDefinitions,
          eq(schema.trackerHits.trackerId, schema.trackerDefinitions.id),
        )
        .where(inArray(schema.trackerHits.callId, ids))
        .groupBy(
          schema.trackerHits.callId,
          schema.trackerHits.trackerId,
          schema.trackerDefinitions.name,
          schema.trackerDefinitions.color,
        );
      for (const h of hitGroups) {
        (trackerHitsByCall[h.callId] ??= []).push({
          trackerId: h.trackerId,
          name: h.name,
          color: h.color,
          hitCount: Number(h.hitCount ?? 0),
        });
      }
      for (const list of Object.values(trackerHitsByCall)) {
        list.sort((a, b) => b.hitCount - a.hitCount);
      }
    }

    const calls = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      thumbnailUrl: r.thumbnailUrl,
      durationMs: r.durationMs,
      status: r.status,
      ownerEmail: r.ownerEmail,
      folderId: r.folderId,
      spaceIds: parseSpaceIds(r.spaceIds),
      tags: tagsByCall[r.id] ?? [],
      viewCount: viewsByCall[r.id] ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      archivedAt: r.archivedAt,
      trashedAt: r.trashedAt,
      mediaKind: r.mediaKind,
      recordedAt: r.recordedAt,
      accountId: r.accountId,
      source: r.source,
      participants: participantsByCall[r.id] ?? [],
      participantSummary: participantsByCall[r.id] ?? [],
      topTrackers: (trackerHitsByCall[r.id] ?? []).slice(0, 3),
      visibility: (r as any).visibility ?? null,
    }));

    return { calls };
  },
});
