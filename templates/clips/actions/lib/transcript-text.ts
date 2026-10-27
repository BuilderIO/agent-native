import { sql, type SQL } from "drizzle-orm";

import { schema } from "../../server/db/index.js";

/**
 * True when a transcript row carries any spoken text, in either the flat text
 * or at least one non-empty segment. NULL for a missing (left-joined) row.
 */
export function transcriptHasTextSql(
  transcripts: typeof schema.recordingTranscripts = schema.recordingTranscripts,
): SQL<boolean | null> {
  return sql<boolean | null>`(
    TRIM(${transcripts.fullText}) <> ''
    OR ${transcripts.segmentsJson} ~ '"text":"[^"]'
  )`;
}
