/**
 * Delegate: regenerate just the topic chapters for a call.
 *
 * Usage:
 *   pnpm action regenerate-topics --callId=<id>
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
    "Queue the agent to regenerate topic chapters for this call. The agent identifies topic transitions in the transcript and calls write-call-topics with the chapter list.",
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
      kind: "topics" as const,
      callId: args.callId,
      requestId,
      ts: new Date().toISOString(),
      currentTitle: call.title,
      durationMs: call.durationMs,
      transcriptStatus: transcript?.status ?? "pending",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      transcriptText: transcript?.fullText ?? "",
      message:
        `Regenerate topic chapters for call ${args.callId} (duration ${call.durationMs}ms). ` +
        `Read the transcript segments, identify topic transitions, and call ` +
        `\`write-call-topics --callId=${args.callId} --topics='[{"title":"Intro","startMs":0,"endMs":60000},...]'\`. ` +
        `Aim for 3–8 chapters. Titles 3–6 words.`,
    };

    await writeAppState(`ai-delegation-${args.callId}-${requestId}`, request);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: topics for ${args.callId}`);
    return { queued: true, callId: args.callId, requestId };
  },
});
