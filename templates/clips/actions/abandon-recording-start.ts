import { defineAction, fail } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { releaseHostedClipRecording } from "../server/lib/video-storage.js";
import trashRecording from "./trash-recording.js";

export default defineAction({
  description: "Discard a recording upload target when capture did not start.",
  agentTool: false,
  schema: z.object({ id: z.string().describe("Recording ID") }),
  run: async (args, actionContext) => {
    await assertAccess("recording", args.id, "editor");
    const [recording] = await getDb()
      .select({ storageMode: schema.recordings.storageMode })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!recording) {
      fail("Recording not found.", {
        errorCode: "recording_not_found",
        statusCode: 404,
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
      const userId = getRequestContext()?.authUserId;
      if (!userId) {
        fail("Hosted Clips reservation cleanup requires the recording owner.", {
          errorCode: "authentication_required",
          statusCode: 401,
          details: { retryable: false, cleanupConfirmed: false },
        });
      }
      await releaseHostedClipRecording({
        recordingId: args.id,
        userId,
      });
    }
    return trashed;
  },
});
