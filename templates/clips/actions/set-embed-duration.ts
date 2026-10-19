import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { recordingEmbedProvider } from "@shared/embed-provider.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const MAX_EMBED_DURATION_MS = 24 * 60 * 60 * 1000;

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Record the duration YouTube's embedded player measured for a YouTube-backed clip. YouTube's metadata has no duration, so the player reports it once; a stored duration is never overwritten.",
  schema: z.object({
    recordingId: z.string().min(1),
    durationMs: z.coerce.number().int().min(1).max(MAX_EMBED_DURATION_MS),
  }),
  // The player calls this; an agent has no measured duration to supply.
  toolCallable: false,
  run: async (args) => {
    const { resource: recording } = await assertAccess(
      "recording",
      args.recordingId,
      "editor",
    );
    if (recordingEmbedProvider(recording) !== "youtube") {
      fail(
        "Only clips that play in YouTube's player take their duration from the player.",
        { errorCode: "embed_duration_unsupported", statusCode: 422 },
      );
    }

    const [updated] = await getDb()
      .update(schema.recordings)
      .set({ durationMs: args.durationMs })
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          eq(schema.recordings.durationMs, 0),
        ),
      )
      .returning({ durationMs: schema.recordings.durationMs });

    return {
      recordingId: args.recordingId,
      durationMs: updated?.durationMs ?? recording.durationMs,
      updated: Boolean(updated),
    };
  },
});
