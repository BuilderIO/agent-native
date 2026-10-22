import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { releaseHostedClipRecording } from "../server/lib/video-storage.js";
import trashRecording from "./trash-recording.js";

export default defineAction({
  description: "Discard a recording upload target when capture did not start.",
  agentTool: false,
  schema: z.object({ id: z.string().describe("Recording ID") }),
  run: async (args, actionContext) => {
    await assertAccess("recording", args.id, "editor");
    const callerEmail = getCurrentOwnerEmail().trim().toLowerCase();
    const [recording] = await getDb()
      .select({
        storageMode: schema.recordings.storageMode,
        ownerEmail: schema.recordings.ownerEmail,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!recording) {
      fail("Recording not found.", {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    if (
      !callerEmail ||
      callerEmail !== recording.ownerEmail?.trim().toLowerCase()
    ) {
      fail("Only the recording owner can discard a recording start.", {
        errorCode: "recording_owner_mismatch",
        statusCode: 403,
      });
    }

    const trashed = await trashRecording.run(
      { id: args.id, skipIfReady: true },
      actionContext,
    );
    if (
      !trashed.skipped &&
      trashed.trashedAt &&
      recording.storageMode === "hosted"
    ) {
      await releaseHostedClipRecording({
        recordingId: args.id,
        ownerEmail: recording.ownerEmail,
      });
    }
    return trashed;
  },
});
