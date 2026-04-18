import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { parseJson } from "../server/lib/calls.js";

export default defineAction({
  description:
    "Cancel a scheduled Recall.ai bot. Calls Recall's DELETE /api/v1/bot/:id and marks the recall_bots row as failed with reason 'cancelled'.",
  schema: z.object({
    botId: z.string().describe("Recall bot ID (recall_bots.id)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const apiKey =
      typeof process !== "undefined" ? process.env.RECALL_AI_API_KEY : undefined;
    if (!apiKey) {
      throw new Error("RECALL_AI_API_KEY is not configured.");
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recallBots)
      .where(eq(schema.recallBots.id, args.botId));
    if (!existing) throw new Error(`Recall bot not found: ${args.botId}`);

    let apiError: string | null = null;
    try {
      const res = await fetch(`https://api.recall.ai/api/v1/bot/${args.botId}`, {
        method: "DELETE",
        headers: { Authorization: `Token ${apiKey}` },
      });
      if (!res.ok && res.status !== 404) {
        const body = await res.text().catch(() => "");
        apiError = `Recall.ai responded with ${res.status}: ${body.slice(0, 200)}`;
      }
    } catch (err) {
      apiError = err instanceof Error ? err.message : String(err);
    }

    const meta = parseJson<Record<string, unknown>>(existing.rawJson, {});
    meta.failureReason = "cancelled";
    if (apiError) meta.cancelError = apiError;

    await db
      .update(schema.recallBots)
      .set({
        status: "failed",
        rawJson: JSON.stringify(meta),
        endedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recallBots.id, args.botId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { botId: args.botId, status: "failed", cancelled: true, apiError };
  },
});
