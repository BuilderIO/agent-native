/**
 * Start recording for a meeting.
 *
 * Creates a `recordings` row in `uploading` status and links it to the
 * meeting (`meetings.recordingId`). Stamps `actualStart` if not yet set.
 *
 * Like `create-recording`, this only allocates the DB row — actual
 * MediaRecorder/native-capture is a UI/Tauri gesture.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  getActiveOrganizationId,
  nanoid,
} from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Start a recording for a meeting. Creates a recording row in `uploading` status and links it to the meeting. Audio capture itself is a UI gesture.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
    title: z.string().optional().describe("Override the recording title"),
    hasCamera: z.boolean().optional().default(false),
    hasAudio: z.boolean().optional().default(true),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.meetingId, "editor");
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const orgId = await getActiveOrganizationId();
    const nowIso = new Date().toISOString();

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId))
      .limit(1);
    if (!meeting) throw new Error(`Meeting not found: ${args.meetingId}`);

    if (meeting.recordingId) {
      // Already linked — return the existing row instead of creating a duplicate.
      const [existing] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, meeting.recordingId))
        .limit(1);
      if (existing) {
        return {
          recording: existing,
          meetingId: args.meetingId,
          created: false,
        };
      }
    }

    const recordingId = nanoid();
    const recordingTitle = args.title ?? meeting.title ?? "Untitled meeting";

    await db.insert(schema.recordings).values({
      id: recordingId,
      organizationId: orgId ?? "",
      title: recordingTitle,
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
      status: "uploading",
      ownerEmail,
      orgId: orgId ?? null,
      visibility: meeting.visibility,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db
      .update(schema.meetings)
      .set({
        recordingId,
        actualStart: meeting.actualStart ?? nowIso,
        transcriptStatus: "pending",
        updatedAt: nowIso,
      })
      .where(eq(schema.meetings.id, args.meetingId));

    // Tell the UI / Tauri tray app to start the actual capture.
    await writeAppState("record-intent", {
      mode: "meeting",
      recordingId,
      meetingId: args.meetingId,
      requestedAt: nowIso,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    const [recording] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);

    return { recording, meetingId: args.meetingId, created: true };
  },
});
