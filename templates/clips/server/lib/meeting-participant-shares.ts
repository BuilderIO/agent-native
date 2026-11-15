/**
 * A public meeting is shared (viewer) with its participants, and so is its
 * recording when that is public too. stop-meeting-recording does this for the
 * people known when the meeting stops; Slack huddle events do it for people
 * who are only reported later.
 */
import shareResource from "@agent-native/core/sharing/actions/share-resource";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { normalizeOwnerEmail } from "./recordings.js";

type ShareableResourceType = "meeting" | "recording";

export async function sharePublicMeetingResourcesWithParticipants(args: {
  meetingId: string;
  recordingId: string | null;
  recordingVisibility: string | null | undefined;
  ownerEmail: string;
  participants: Array<{ email: string }>;
}) {
  const ownerEmail = normalizeOwnerEmail(args.ownerEmail);
  const participantEmails = [
    ...new Set(
      args.participants
        .map((participant) => normalizeOwnerEmail(participant.email))
        .filter((email) => email && email !== ownerEmail),
    ),
  ];
  if (!participantEmails.length) return;

  const resources: Array<{
    resourceType: ShareableResourceType;
    resourceId: string;
  }> = [
    { resourceType: "meeting", resourceId: args.meetingId },
    ...(args.recordingId && args.recordingVisibility === "public"
      ? [{ resourceType: "recording" as const, resourceId: args.recordingId }]
      : []),
  ];

  await Promise.all(
    resources.flatMap(({ resourceType, resourceId }) =>
      participantEmails.map((principalId) =>
        Promise.resolve(
          shareResource.run({
            resourceType,
            resourceId,
            principalType: "user",
            principalId,
            role: "viewer",
            notify: false,
          }),
        ),
      ),
    ),
  );
}

/**
 * Huddle participants reported after the meeting stopped: share the public
 * meeting (and public recording) with them as the meeting's owner, the same
 * grants the stop gave the people known then. Meetings that are private or
 * still recording are left alone; their stop shares with everyone.
 */
export async function shareStoppedMeetingWithHuddleParticipants(
  meetingId: string,
  emails: string[],
): Promise<void> {
  const db = getDb();
  const [meeting] = await db
    .select({
      ownerEmail: schema.meetings.ownerEmail,
      orgId: schema.meetings.orgId,
      visibility: schema.meetings.visibility,
      actualEnd: schema.meetings.actualEnd,
      recordingId: schema.meetings.recordingId,
    })
    .from(schema.meetings)
    .where(eq(schema.meetings.id, meetingId))
    .limit(1);
  if (
    !meeting?.ownerEmail ||
    meeting.visibility !== "public" ||
    !meeting.actualEnd
  ) {
    return;
  }
  let recordingVisibility: string | null = null;
  if (meeting.recordingId) {
    const [recording] = await db
      .select({ visibility: schema.recordings.visibility })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, meeting.recordingId))
      .limit(1);
    recordingVisibility = recording?.visibility ?? null;
  }
  await runWithRequestContext(
    { userEmail: meeting.ownerEmail, orgId: meeting.orgId ?? undefined },
    () =>
      sharePublicMeetingResourcesWithParticipants({
        meetingId,
        recordingId: meeting.recordingId,
        recordingVisibility,
        ownerEmail: meeting.ownerEmail,
        participants: emails.map((email) => ({ email })),
      }),
  );
}
