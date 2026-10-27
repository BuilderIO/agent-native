import { isNull, ne, or } from "drizzle-orm";

import { schema } from "../../server/db/index.js";
import { IMPORTED_TRANSCRIPT_SOURCE } from "../../shared/transcript-import.js";

/**
 * Where-clause for automatic transcript writers. An imported transcript came
 * from a file the owner or an agent chose, so no automatic pass may replace
 * it; only an explicit regenerate or another import can.
 */
export function notImportedTranscript() {
  const t = schema.recordingTranscripts;
  return or(isNull(t.source), ne(t.source, IMPORTED_TRANSCRIPT_SOURCE));
}
