/**
 * Delegate: ask the agent to propose 3–5 share-worthy snippet moments.
 *
 * The agent reads the transcript, picks the best clips, then calls
 * `write-suggested-snippets` with { title, startMs, endMs, reason } entries.
 *
 * Usage:
 *   pnpm action suggest-snippets --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Queue the agent to propose 3–5 share-worthy moments from this call. Stored under app-state call-suggested-snippets-<callId> via write-suggested-snippets.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const [call] = await db
      .select({
        id: schema.calls.id,
        title: schema.calls.title,
        durationMs: schema.calls.durationMs,
      })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);

    const [transcript] = await db
      .select()
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    const requestId = nanoid();
    const request = {
      kind: "suggest-snippets" as const,
      callId: args.callId,
      requestId,
      ts: new Date().toISOString(),
      currentTitle: call.title,
      durationMs: call.durationMs,
      transcriptStatus: transcript?.status ?? "pending",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      transcriptText: transcript?.fullText ?? "",
      message:
        `Suggest 3–5 share-worthy snippet moments from call ${args.callId}. ` +
        `Read the transcript, pick the clips most worth sharing (a-ha moments, strong objections, ` +
        `buying signals, key decisions, memorable quotes). Each should be 15–90 seconds. ` +
        `Then call \`write-suggested-snippets --callId=${args.callId} --snippets='[{"title":"...","startMs":<n>,"endMs":<n>,"reason":"..."},...]'\`. ` +
        `Title: 3–8 words. Reason: one sentence on why this is share-worthy.`,
    };

    await writeAppState(`ai-delegation-${args.callId}-${requestId}`, request);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: suggest-snippets for ${args.callId}`);
    return { queued: true, callId: args.callId, requestId };
  },
});
