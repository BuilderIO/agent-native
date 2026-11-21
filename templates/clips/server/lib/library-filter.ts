import { getRequestTimezone } from "@agent-native/core/server/request-context";
import {
  filterToday,
  pinnedFilterValue,
  type FilterState,
} from "@agent-native/toolkit/app/filters/model";
import { and, eq, inArray, not, sql, type SQL } from "drizzle-orm";

import { transcriptHasTextSql } from "../../actions/lib/transcript-text.js";
import {
  effectiveDuration,
  parseEdits,
} from "../../app/lib/timestamp-mapping.js";
import {
  evaluateLibraryFilter,
  LIBRARY_FILTER_LABELS_EN,
  LIBRARY_SOURCE_FIELD,
  LIBRARY_SOURCES,
  libraryFilterFields,
  type LibraryFilterResult,
  type LibrarySource,
} from "../../shared/library-filters.js";
import { getDb, schema } from "../db/index.js";
import {
  activeUploadFromContent,
  uploadedFromContent,
} from "./content-uploads.js";

const SOURCE_FIELD = libraryFilterFields(LIBRARY_FILTER_LABELS_EN).find(
  (field) => field.id === LIBRARY_SOURCE_FIELD,
);

function requestTimeZone(): string | undefined {
  const zone = getRequestTimezone();
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
    // coercion-ok: a zone the runtime can't read leaves dates in UTC.
  } catch {
    return undefined;
  }
}

export function librarySources(state: FilterState): LibrarySource[] {
  const value = SOURCE_FIELD ? pinnedFilterValue(state, SOURCE_FIELD) : [];
  return LIBRARY_SOURCES.filter((source) => value.includes(source));
}

export function librarySourceCondition(state: FilterState): SQL | undefined {
  const sources = librarySources(state);
  if (sources.length === LIBRARY_SOURCES.length) return undefined;
  return sources.includes("content")
    ? activeUploadFromContent()
    : not(uploadedFromContent());
}

export async function filterLibraryRecordings({
  where,
  state,
  orderBy,
  listWithin,
}: {
  where: (SQL | undefined)[];
  state: FilterState;
  orderBy: SQL[];
  listWithin?: SQL | undefined;
}): Promise<LibraryFilterResult> {
  // guard:allow-unscoped — both callers, list-recordings and view-screen, put their access filter in `where`.
  const timeZone = requestTimeZone();
  const db = await Promise.resolve(getDb());
  const condition = and(...where);
  const candidateIds = db
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(condition);
  const [rows, tagRows] = await Promise.all([
    db
      .select({
        id: schema.recordings.id,
        createdAt: schema.recordings.createdAt,
        madeBy: schema.recordings.madeBy,
        visibility: schema.recordings.visibility,
        durationMs: schema.recordings.durationMs,
        editsJson: schema.recordings.editsJson,
        fromContent: sql<number>`(
          CASE WHEN ${activeUploadFromContent()} THEN 1 ELSE 0 END
        )`,
        shared: sql<number>`(
          CASE WHEN EXISTS (SELECT 1 FROM ${schema.recordingShares} WHERE ${schema.recordingShares.resourceId} = ${schema.recordings.id}) THEN 1 ELSE 0 END
        )`,
        hasTranscript: sql<number>`(
          CASE WHEN ${transcriptHasTextSql()} THEN 1 ELSE 0 END
        )`,
        listed: listWithin
          ? sql<number>`(CASE WHEN ${listWithin} THEN 1 ELSE 0 END)`
          : sql<number>`1`,
      })
      .from(schema.recordings)
      .leftJoin(
        schema.recordingTranscripts,
        eq(schema.recordingTranscripts.recordingId, schema.recordings.id),
      )
      .where(condition)
      .orderBy(...orderBy),
    db
      .select({
        recordingId: schema.recordingTags.recordingId,
        tag: schema.recordingTags.tag,
      })
      .from(schema.recordingTags)
      .where(inArray(schema.recordingTags.recordingId, candidateIds)),
  ]);
  const tagsByRecording = new Map<string, string[]>();
  for (const row of tagRows) {
    const tags = tagsByRecording.get(row.recordingId) ?? [];
    tags.push(row.tag);
    tagsByRecording.set(row.recordingId, tags);
  }
  const listedIds = new Set(
    rows.filter((row) => Number(row.listed) > 0).map((row) => row.id),
  );
  return evaluateLibraryFilter(
    rows.map((row) => ({
      id: row.id,
      source: Number(row.fromContent) > 0 ? "content" : "clips",
      madeBy: row.madeBy ?? null,
      createdAt: row.createdAt,
      visibility: row.visibility,
      shared: Number(row.shared) > 0,
      durationMs: effectiveDuration(row.durationMs, parseEdits(row.editsJson)),
      tags: tagsByRecording.get(row.id) ?? [],
      hasTranscript: Number(row.hasTranscript) > 0,
    })),
    state,
    { today: filterToday(timeZone), ...(timeZone ? { timeZone } : {}) },
    listWithin ? (row) => listedIds.has(row.id) : undefined,
  );
}
