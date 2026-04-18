/**
 * Persist just the `topicsJson` on a call summary.
 *
 * Usage (agent-only):
 *   pnpm action write-call-topics --callId=<id> --topics='[{"title":"Intro","startMs":0}]'
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

const TopicSchema = z.object({
  title: z.string().min(1),
  startMs: z.coerce.number().int().min(0),
  endMs: z.coerce.number().int().min(0).optional(),
});

export default defineAction({
  description:
    "Write just the topic chapters on a call summary. Topics shape: [{title,startMs,endMs?}]. Called by the agent after regenerate-topics.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    topics: z
      .union([z.string(), z.array(TopicSchema)])
      .describe(
        "Array of topic chapters — JSON-encoded string (CLI) or array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    let topics: Array<z.infer<typeof TopicSchema>>;
    if (typeof args.topics === "string") {
      let raw: unknown;
      try {
        raw = JSON.parse(args.topics);
      } catch (e) {
        throw new Error(`Invalid --topics JSON: ${(e as Error).message}`);
      }
      topics = z.array(TopicSchema).parse(raw);
    } else {
      topics = z.array(TopicSchema).parse(args.topics);
    }

    topics = topics
      .map((t) => ({
        title: t.title.trim(),
        startMs: Math.max(0, t.startMs),
        ...(typeof t.endMs === "number" ? { endMs: Math.max(0, t.endMs) } : {}),
      }))
      .filter((t) => t.title.length > 0)
      .sort((a, b) => a.startMs - b.startMs);

    const db = getDb();
    const nowIso = new Date().toISOString();
    const topicsJson = JSON.stringify(topics);

    const [existing] = await db
      .select({ callId: schema.callSummaries.callId })
      .from(schema.callSummaries)
      .where(eq(schema.callSummaries.callId, args.callId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.callSummaries)
        .set({ topicsJson, updatedAt: nowIso })
        .where(eq(schema.callSummaries.callId, args.callId));
    } else {
      await db.insert(schema.callSummaries).values({
        callId: args.callId,
        topicsJson,
        generatedBy: "agent",
        generatedAt: nowIso,
        updatedAt: nowIso,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Wrote ${topics.length} topic(s) for call ${args.callId}`);
    return { callId: args.callId, topics };
  },
});
