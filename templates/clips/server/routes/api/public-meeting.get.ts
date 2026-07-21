/**
 * GET /api/public-meeting?id=<meetingId>
 *
 * Access-checked meeting notes for the anonymous share surface. Meeting access
 * governs the payload; the linked transcript is an explicit, default-off part
 * of that share and is omitted unless the meeting owner enables it.
 */

import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../../../shared/transcript-segments.js";
import { resolveTranscriptPresentation } from "../../../shared/transcript-status.js";
import { getDb, schema } from "../../db/index.js";

interface Bullet {
  text: string;
}

function parseBullets(raw: string | null | undefined): Bullet[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (bullet): bullet is Bullet =>
        typeof bullet === "object" &&
        bullet !== null &&
        typeof bullet.text === "string",
    );
  } catch {
    return [];
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");

  const query = getQuery(event);
  const meetingId = typeof query.id === "string" ? query.id : "";
  if (!meetingId) {
    setResponseStatus(event, 400);
    return { error: "id is required" };
  }

  const session = await getSession(event).catch(() => null);
  const accessContext = {
    userEmail: session?.email,
    orgId: session?.orgId,
  };

  return runWithRequestContext(accessContext, async () => {
    const access = await resolveAccess("meeting", meetingId, accessContext);
    const meeting = access?.resource;
    if (!meeting || meeting.trashedAt) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    const db = getDb();
    const [participants, actionItems, transcriptRows] = await Promise.all([
      db
        .select({
          email: schema.meetingParticipants.email,
          name: schema.meetingParticipants.name,
          isOrganizer: schema.meetingParticipants.isOrganizer,
        })
        .from(schema.meetingParticipants)
        .where(eq(schema.meetingParticipants.meetingId, meetingId)),
      db
        .select({
          id: schema.meetingActionItems.id,
          text: schema.meetingActionItems.text,
          assigneeEmail: schema.meetingActionItems.assigneeEmail,
          completedAt: schema.meetingActionItems.completedAt,
        })
        .from(schema.meetingActionItems)
        .where(eq(schema.meetingActionItems.meetingId, meetingId)),
      meeting.shareTranscript && meeting.recordingId
        ? db
            .select({
              status: schema.recordingTranscripts.status,
              language: schema.recordingTranscripts.language,
              fullText: schema.recordingTranscripts.fullText,
              failureReason: schema.recordingTranscripts.failureReason,
              segmentsJson: schema.recordingTranscripts.segmentsJson,
              updatedAt: schema.recordingTranscripts.updatedAt,
            })
            .from(schema.recordingTranscripts)
            .where(
              eq(schema.recordingTranscripts.recordingId, meeting.recordingId),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

    const transcript = transcriptRows[0] ?? null;
    const transcriptPresentation = resolveTranscriptPresentation(transcript);
    const transcriptSegments = transcript
      ? normalizeTranscriptSegments({
          segments: parseTranscriptSegments(transcript.segmentsJson),
          fullText: transcript.fullText,
        })
      : [];
    const role = access.role;

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        scheduledStart: meeting.scheduledStart,
        actualStart: meeting.actualStart,
        actualEnd: meeting.actualEnd,
        transcriptStatus: meeting.transcriptStatus,
        summaryMd: meeting.summaryMd,
        bullets: parseBullets(meeting.bulletsJson),
        participants,
        actionItems,
        ...(meeting.shareTranscript
          ? {
              transcript: transcript
                ? {
                    status: transcriptPresentation.status,
                    language: transcript.language,
                    fullText: transcript.fullText,
                    segments: transcriptSegments,
                  }
                : null,
            }
          : {}),
      },
      viewer: session?.email
        ? {
            role,
            canEdit: role === "owner" || role === "admin" || role === "editor",
            isOwner: role === "owner",
          }
        : null,
    };
  });
});
