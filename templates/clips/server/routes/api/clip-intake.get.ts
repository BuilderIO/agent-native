// guard:allow-api-route - anonymous intake status is a signed recovery transport, not a CRUD API.

import { and, eq } from "drizzle-orm";
import { defineEventHandler, getQuery, type H3Event } from "h3";

import { getDb, schema } from "../../db/index.js";
import {
  completeClipIntake,
  resolveClipIntakeStatusRequest,
} from "../../lib/clip-intake.js";
import { ownerEmailMatches } from "../../lib/recordings.js";

function queryString(event: H3Event, key: string): string | null {
  const value = getQuery(event)[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

export default defineEventHandler(async (event: H3Event) => {
  if (queryString(event, "operation") !== "status") {
    return { recording: null };
  }

  const recordingId = queryString(event, "recordingId");
  if (!recordingId || recordingId.length > 200 || /[\r\n]/.test(recordingId)) {
    return { recording: null };
  }

  const session = await resolveClipIntakeStatusRequest(event, recordingId);
  const [recording] = await getDb()
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      videoUrl: schema.recordings.videoUrl,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, session.ownerEmail),
        eq(schema.recordings.organizationId, session.organizationId),
      ),
    )
    .limit(1);

  if (!recording) return { recording: null };

  if (recording.status === "ready" && recording.videoUrl) {
    await completeClipIntake(session.id, recordingId);
  }

  return {
    recording: {
      id: recording.id,
      status: recording.status,
      ...(recording.status === "processing" && recording.videoUrl
        ? { verificationPending: true }
        : {}),
    },
  };
});
