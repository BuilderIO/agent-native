import { and, eq } from "drizzle-orm";

import { isMotionCaptureMetadataJson } from "../../shared/recording-capture.js";
import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

export async function inheritedMotionCaptureMetadataJson(input: {
  recordingSource: string | null | undefined;
  originalRecordingId: string | null | undefined;
  ownerEmail: string;
}): Promise<string | null> {
  if (input.recordingSource !== "local_copy_upload") return null;
  if (!input.originalRecordingId) return null;
  const rows = await getDb()
    .select({ captureMetadataJson: schema.recordings.captureMetadataJson })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, input.originalRecordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
      ),
    )
    .limit(1);
  const stored = rows.length > 0 ? rows[0]?.captureMetadataJson : null;
  return isMotionCaptureMetadataJson(stored) ? (stored ?? null) : null;
}
