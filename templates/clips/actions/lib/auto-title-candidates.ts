import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import type { AutoTitleCandidate } from "../../shared/ai-request-status.js";
import {
  AUTO_REPLACEABLE_TITLE_SOURCES,
  DEFAULT_RECORDING_TITLE,
} from "../../shared/title-source.js";
import { transcriptHasTextSql } from "./transcript-text.js";

export const AUTO_TITLE_CANDIDATE_LIMIT = 50;

/**
 * The owner's ready recordings that still carry a replaceable title and have
 * transcript text to title from — the SQL form of `isAutoTitleReplaceable`.
 */
export function listAutoTitleCandidates(
  ownerEmail: string,
): Promise<AutoTitleCandidate[]> {
  const r = schema.recordings;
  const t = schema.recordingTranscripts;
  return getDb()
    .select({ id: r.id, createdAt: r.createdAt })
    .from(r)
    .innerJoin(t, eq(t.recordingId, r.id))
    .where(
      and(
        ownerEmailMatches(r.ownerEmail, ownerEmail),
        eq(r.status, "ready"),
        isNull(r.trashedAt),
        or(
          inArray(r.titleSource, [...AUTO_REPLACEABLE_TITLE_SOURCES]),
          sql`TRIM(${r.title}) IN ('', ${DEFAULT_RECORDING_TITLE})`,
        ),
        eq(t.status, "ready"),
        transcriptHasTextSql(t),
      ),
    )
    .orderBy(desc(r.createdAt))
    .limit(AUTO_TITLE_CANDIDATE_LIMIT);
}
