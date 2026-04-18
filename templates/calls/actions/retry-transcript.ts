/**
 * Reset a call's transcript to pending and re-run `request-transcript`.
 *
 * Usage:
 *   pnpm action retry-transcript --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import requestTranscript from "./request-transcript.js";

export default defineAction({
  description:
    "Retry a failed or stale transcript: reset call_transcripts to pending and re-invoke request-transcript.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const nowIso = new Date().toISOString();

    const [existing] = await db
      .select({ callId: schema.callTranscripts.callId })
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.callTranscripts)
        .set({
          status: "pending",
          failureReason: null,
          updatedAt: nowIso,
        })
        .where(eq(schema.callTranscripts.callId, args.callId));
    } else {
      await db.insert(schema.callTranscripts).values({
        callId: args.callId,
        ownerEmail,
        language: "en",
        provider: "deepgram",
        segmentsJson: "[]",
        fullText: "",
        status: "pending",
        failureReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    await db
      .update(schema.calls)
      .set({
        status: "transcribing",
        failureReason: null,
        updatedAt: nowIso,
      })
      .where(eq(schema.calls.id, args.callId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return await requestTranscript.run({ callId: args.callId } as any);
  },
});
