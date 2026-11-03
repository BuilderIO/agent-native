import { fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

interface DescriptionRecording {
  id: string;
  ownerEmail: string;
  description?: string | null;
  descriptionSource?: string | null;
}
interface DescriptionPublication {
  description: string;
}

export function publicRecordingDescription(
  recording: DescriptionRecording,
  legacyPublication?: DescriptionPublication,
) {
  if (legacyPublication) return legacyPublication.description;
  if (recording.descriptionSource === "report") return "";
  return recording.description ?? "";
}

export async function loadLegacyDescriptionPublication(
  recordings: readonly DescriptionRecording[],
) {
  const candidates = recordings.filter(
    (recording) =>
      recording.description &&
      recording.descriptionSource !== "user" &&
      recording.descriptionSource !== "report",
  );
  if (!candidates.length) return new Map<string, DescriptionPublication>();
  const rows = await getDb()
    .select({
      id: schema.recordings.id,
      ownerEmail: schema.recordings.ownerEmail,
      description: schema.recordings.description,
      descriptionSource: schema.recordings.descriptionSource,
      reportDescription: schema.recordingBugReports.description,
    })
    .from(schema.recordings)
    .leftJoin(
      schema.recordingBugReports,
      eq(schema.recordingBugReports.recordingId, schema.recordings.id),
    )
    .where(
      and(
        inArray(
          schema.recordings.id,
          candidates.map((recording) => recording.id),
        ),
        inArray(
          schema.recordings.ownerEmail,
          candidates.map((recording) => recording.ownerEmail),
        ),
      ),
    )
    .limit(candidates.length);
  const publications = new Map(
    rows.map((row) => [
      row.id,
      {
        description: publicRecordingDescription(
          row,
          row.descriptionSource !== "user" &&
            row.reportDescription !== null &&
            row.reportDescription === row.description
            ? { description: "" }
            : undefined,
        ),
      },
    ]),
  );
  for (const recording of candidates)
    if (!publications.has(recording.id))
      fail("The recording is no longer available.", {
        errorCode: "recording_unavailable",
        statusCode: 410,
      });
  return publications;
}

export async function loadPublicRecordingDescription(
  recording: DescriptionRecording,
) {
  const publications = await loadLegacyDescriptionPublication([recording]);
  return publicRecordingDescription(recording, publications.get(recording.id));
}
