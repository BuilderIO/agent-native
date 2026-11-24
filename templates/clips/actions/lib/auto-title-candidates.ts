import { readAppState } from "@agent-native/core/application-state";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import type { AutoTitleCandidate } from "../../shared/ai-request-status.js";
import {
  AUTO_REPLACEABLE_TITLE_SOURCES,
  DEFAULT_RECORDING_TITLE,
} from "../../shared/title-source.js";
import { titleTerminalKey } from "./ai-request-status.js";
import { transcriptHasTextSql } from "./transcript-text.js";

export const AUTO_TITLE_CANDIDATE_LIMIT = 50;

/**
 * The owner's ready recordings that still carry a replaceable title and have
 * transcript text to title from — the SQL form of `isAutoTitleReplaceable`.
 */
export async function listAutoTitleCandidates(
  ownerEmail: string,
): Promise<AutoTitleCandidate[]> {
  const r = schema.recordings;
  const t = schema.recordingTranscripts;
  // Ensure the framework store exists before joining it on a cold database.
  await readAppState(titleTerminalKey(""));
  return getDb()
    .select({
      id: r.id,
      createdAt: r.createdAt,
      transcriptRevision: sql<string>`md5(${t.fullText} || chr(31) || ${t.segmentsJson})`,
    })
    .from(r)
    .innerJoin(t, eq(t.recordingId, r.id))
    .where(
      and(
        ownerEmailMatches(r.ownerEmail, ownerEmail),
        eq(r.status, "ready"),
        isNull(r.trashedAt),
        ne(r.titleSource, "manual"),
        or(
          inArray(r.titleSource, [...AUTO_REPLACEABLE_TITLE_SOURCES]),
          sql`TRIM(${r.title}) IN ('', ${DEFAULT_RECORDING_TITLE})`,
        ),
        eq(t.status, "ready"),
        transcriptHasTextSql(t),
        sql`NOT EXISTS (
          SELECT 1 FROM application_state marker
          WHERE marker.session_id = ${ownerEmail}
            AND marker.key = ${titleTerminalKey("")} || ${r.id}
            AND marker.value::jsonb ->> 'suppressed' = 'true'
            AND (marker.value::jsonb ->> 'transcriptRevision' IS NULL OR
                 marker.value::jsonb ->> 'transcriptRevision' = md5(${t.fullText} || chr(31) || ${t.segmentsJson}))
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM application_state request_status
          WHERE request_status.session_id = ${ownerEmail}
            AND request_status.key = ${"clips-ai-request-status-"} || ${r.id}
            AND request_status.value::jsonb ->> 'kind' IN ('regenerate-title', 'generate-metadata')
            AND request_status.value::jsonb ->> 'status' IN ('failed', 'truncated', 'cancelled')
            AND (request_status.value::jsonb ->> 'transcriptRevision' IS NULL OR
                 request_status.value::jsonb ->> 'transcriptRevision' = md5(${t.fullText} || chr(31) || ${t.segmentsJson}))
            AND NOT EXISTS (
              SELECT 1 FROM application_state cleared
              WHERE cleared.session_id = ${ownerEmail}
                AND cleared.key = ${titleTerminalKey("")} || ${r.id}
                AND cleared.value::jsonb ->> 'suppressed' = 'false'
                AND cleared.value::jsonb -> 'supersededStatus' = request_status.value::jsonb
            )
        )`,
      ),
    )
    .orderBy(desc(r.createdAt))
    .limit(AUTO_TITLE_CANDIDATE_LIMIT);
}
