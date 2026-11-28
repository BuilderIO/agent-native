/**
 * The desktop app is about to upload a meeting's audio.
 *
 * A meeting the Mac records itself is uploaded as a stereo file with the
 * microphone on the left and the call's system audio on the right. This
 * records that layout for the meeting's recording, so the transcript made from
 * the file puts the owner's name on the microphone's lines and the upload
 * replaces the live transcript with one that has speakers.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  MEETING_AUDIO_LAYOUT,
  saveMeetingAudioLayout,
} from "../server/lib/meeting-audio-channels.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";

export default defineAction({
  description:
    "Internal, called by the Clips desktop app before it uploads a meeting's audio: marks the meeting recording's media as microphone on the left channel and system audio on the right, so its transcript names the owner's lines.",
  schema: z.object({
    recordingId: z.string().describe("The meeting's recording ID"),
  }),
  run: async (args) => {
    const access = assertRecordingNotExpired(
      await assertAccess("recording", args.recordingId, "editor"),
    );
    const [meeting] = await getDb()
      .select({ id: schema.meetings.id })
      .from(schema.meetings)
      .where(eq(schema.meetings.recordingId, args.recordingId))
      .limit(1);
    if (!meeting) {
      fail(`No meeting uses recording ${args.recordingId}`, {
        errorCode: "meeting_not_found",
        statusCode: 404,
      });
    }
    await saveMeetingAudioLayout(args.recordingId, access.resource.ownerEmail);
    return {
      recordingId: args.recordingId,
      meetingId: meeting.id,
      layout: MEETING_AUDIO_LAYOUT,
    };
  },
});
