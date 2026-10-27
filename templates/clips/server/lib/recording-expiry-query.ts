import { sql } from "drizzle-orm";

import { schema } from "../db/index.js";
import { RECORDING_EXPIRY_PATTERN } from "./recording-page-access.js";
import { ownerEmailMatches } from "./recordings.js";

export function recordingExpiryQuery(
  userEmail: string | null | undefined,
  now = Date.now(),
) {
  const owner = userEmail
    ? ownerEmailMatches(schema.recordings.ownerEmail, userEmail)
    : sql`false`;
  // PostgreSQL 15 SQL/JSON needs a numeric offset instead of UTC Z.
  const current = sql<
    boolean | null
  >`case when ${schema.recordings.expiresAt} ~ ${RECORDING_EXPIRY_PATTERN.source} then jsonb_path_match_tz(
    to_jsonb(regexp_replace(${schema.recordings.expiresAt}, '[zZ]$', '+00:00')),
    '$.datetime() >= $now.datetime()',
    jsonb_build_object('now', ${new Date(now).toISOString().replace(/Z$/, "+00:00")}::text), true
  ) else null end`;
  const absent = sql`nullif(${schema.recordings.expiresAt}, '') is null`;
  return {
    available: sql`case when ${owner} then true when ${absent} then true else ${current} end`,
    needsRepair: sql<boolean>`not (${absent}) and ${current} is null`,
  };
}
