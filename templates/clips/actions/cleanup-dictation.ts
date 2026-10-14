import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import cleanupTranscript from "./cleanup-transcript.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";

const DICTATION_NOT_FOUND = {
  errorCode: "dictation_not_found",
  statusCode: 404,
} as const;

export default defineAction({
  description:
    "Clean up a dictation's raw text via the low-cost text-model cleanup pass. Stores the result on `dictations.cleanedText` and returns its cleanup version for undo. Editor access required.",
  schema: z.object({
    id: z.string().describe("Dictation id"),
  }),
  run: async (args) => {
    await assertAccess("dictation", args.id, "editor");
    const db = getDb();
    const [dictation] = await db
      .select()
      .from(schema.dictations)
      .where(eq(schema.dictations.id, args.id))
      .limit(1);
    if (!dictation)
      fail(`Dictation not found: ${args.id}`, DICTATION_NOT_FOUND);

    const raw = dictation.fullText?.trim() ?? "";
    if (!raw) {
      fail("Dictation has no transcript to clean up", {
        errorCode: "dictation_transcript_required",
        statusCode: 422,
      });
    }

    const agentsContext = await loadAgentsMdContext({
      ownerEmail: dictation.ownerEmail,
      purpose: "cleanup",
    });
    const result = await cleanupTranscript.run({
      transcript: raw,
      task: "cleanup",
      context: agentsContext,
    });
    const cleanedText = result.cleanedText ?? raw;
    const [updated] = await db
      .update(schema.dictations)
      .set({
        cleanedText,
        updatedAt: new Date().toISOString(),
        cleanupVersion: sql`${schema.dictations.cleanupVersion} + 1`,
      })
      .where(eq(schema.dictations.id, args.id))
      .returning({ cleanupVersion: schema.dictations.cleanupVersion });

    if (!updated) fail(`Dictation not found: ${args.id}`, DICTATION_NOT_FOUND);

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.id,
      cleanedText,
      cleanupVersion: updated.cleanupVersion,
      provider: result.provider,
    };
  },
});
