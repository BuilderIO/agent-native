/**
 * Delegate: regenerate just the next-steps / action-items for a call.
 *
 * Usage:
 *   pnpm action regenerate-next-steps --callId=<id>
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
    "Queue the agent to regenerate only the next-steps and action-items for this call. The agent calls write-next-steps with two arrays.",
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
    const request = {
      kind: "next-steps" as const,
      callId: args.callId,
      requestId,
      ts: new Date().toISOString(),
      currentTitle: call.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText: transcript?.fullText ?? "",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      message:
        `Regenerate next steps and action items for call ${args.callId}. ` +
        `Read the transcript, extract follow-up commitments and assigned actions, then call ` +
        `\`write-next-steps --callId=${args.callId} --nextSteps='[...]' --actionItems='[...]'\`. ` +
        `nextSteps items: { text, owner?, dueAt?, quoteMs? }. actionItems items: { text, owner?, ms? }. ` +
        `Prefer concrete, assignable items. Omit anything speculative.`,
    };

    await writeAppState(`ai-delegation-${args.callId}-${requestId}`, request);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: next-steps for ${args.callId}`);
    return { queued: true, callId: args.callId, requestId };
  },
});
