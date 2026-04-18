import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Permanently delete a call and every related row (transcript, summary, participants, tags, comments, viewers, events, tracker hits, snippets + snippet shares/viewers, call shares). Admin only, irreversible.",
  schema: z.object({
    id: z.string().describe("Call ID"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "admin");

    const db = getDb();

    const snippetIds = (
      await db
        .select({ id: schema.snippets.id })
        .from(schema.snippets)
        .where(eq(schema.snippets.callId, args.id))
    ).map((r) => r.id);

    if (snippetIds.length) {
      await db
        .delete(schema.snippetShares)
        .where(inArray(schema.snippetShares.resourceId, snippetIds));
      await db
        .delete(schema.snippetViewers)
        .where(inArray(schema.snippetViewers.snippetId, snippetIds));
      await db
        .delete(schema.snippets)
        .where(inArray(schema.snippets.id, snippetIds));
    }

    await db
      .delete(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.id));
    await db
      .delete(schema.callSummaries)
      .where(eq(schema.callSummaries.callId, args.id));
    await db
      .delete(schema.callParticipants)
      .where(eq(schema.callParticipants.callId, args.id));
    await db.delete(schema.callTags).where(eq(schema.callTags.callId, args.id));
    await db
      .delete(schema.callComments)
      .where(eq(schema.callComments.callId, args.id));
    await db
      .delete(schema.callViewers)
      .where(eq(schema.callViewers.callId, args.id));
    await db
      .delete(schema.callEvents)
      .where(eq(schema.callEvents.callId, args.id));
    await db
      .delete(schema.trackerHits)
      .where(eq(schema.trackerHits.callId, args.id));
    await db
      .delete(schema.callShares)
      .where(eq(schema.callShares.resourceId, args.id));
    await db.delete(schema.calls).where(eq(schema.calls.id, args.id));

    await deleteAppState(`call-upload-${args.id}`);
    await deleteAppState(`call-blob-${args.id}`);

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Permanently deleted call ${args.id}`);
    return { success: true, id: args.id };
  },
});
