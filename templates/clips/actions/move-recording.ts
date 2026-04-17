import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Move a recording to a different folder (or to the library root when folderId is null).",
  schema: z.object({
    id: z.string().min(1).describe("Recording id"),
    folderId: z
      .string()
      .nullish()
      .describe("Target folder id, or null for root"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(schema.recordings)
      .set({ folderId: args.folderId ?? null, updatedAt: now })
      .where(eq(schema.recordings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, folderId: args.folderId ?? null };
  },
});
