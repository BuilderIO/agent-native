/**
 * Return the full transcript for a call.
 *
 * Usage:
 *   pnpm action get-transcript --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import type { TranscriptSegment } from "../shared/api.js";

export default defineAction({
  description:
    "Return the full transcript (segments + fullText + language + status) for a call.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "viewer");

    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    if (!row) {
      return {
        callId: args.callId,
        status: "pending" as const,
        language: "en",
        segments: [] as TranscriptSegment[],
        fullText: "",
        failureReason: null,
        provider: "deepgram" as const,
        updatedAt: null as string | null,
      };
    }

    return {
      callId: row.callId,
      status: row.status,
      language: row.language,
      provider: row.provider,
      segments: parseJson<TranscriptSegment[]>(row.segmentsJson, []),
      fullText: row.fullText,
      failureReason: row.failureReason,
      updatedAt: row.updatedAt,
    };
  },
});
