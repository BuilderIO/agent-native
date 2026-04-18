/**
 * Delegate: regenerate the AI summary (recap + key points + action items) for a call.
 *
 * Server-side actions can't call LLMs directly. We write a delegation request
 * to application_state; the agent chat (in the open UI) picks it up, reads the
 * transcript, and calls `write-call-summary` with the generated JSON.
 *
 * Usage:
 *   pnpm action regenerate-summary --callId=<id>
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
    "Queue the agent to regenerate the AI summary (recap + key points + action items) for this call. The agent reads the transcript and calls write-call-summary with the generated JSON.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const [call] = await db
      .select({ id: schema.calls.id, title: schema.calls.title })
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
    const nowIso = new Date().toISOString();

    const request = {
      kind: "summary" as const,
      callId: args.callId,
      requestId,
      ts: nowIso,
      currentTitle: call.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText: transcript?.fullText ?? "",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      message:
        `Regenerate the AI summary for call ${args.callId}. ` +
        `Read the transcript in this request's context, then call ` +
        `\`write-call-summary --callId=${args.callId} --summary='<json>'\` ` +
        `with fields { recap, keyPoints[], nextSteps[], topics[], questions[], actionItems[], sentiment }. ` +
        `Recap: 3–5 sentence executive summary. keyPoints/nextSteps/actionItems each 3–7 items. ` +
        `topics is 3–8 chapters with startMs + title. questions are distinct questions asked.`,
    };

    await writeAppState(`ai-delegation-${args.callId}-${requestId}`, request);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: summary for ${args.callId}`);
    return { queued: true, callId: args.callId, requestId };
  },
});
