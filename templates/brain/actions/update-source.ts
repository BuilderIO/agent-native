import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  serializeSource,
  stableJson,
} from "../server/lib/brain.js";
import { optionalJsonRecordSchema } from "./_schemas.js";

export default defineAction({
  description: "Update a Brain source's title, status, config, or cursor.",
  schema: z.object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    status: z.enum(["active", "paused", "archived", "error"]).optional(),
    config: optionalJsonRecordSchema,
    cursor: optionalJsonRecordSchema,
  }),
  run: async (args) => {
    const access = await assertAccess("brain-source", args.id, "editor");
    const existing = access.resource;
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.status !== undefined) updates.status = args.status;
    if (args.config !== undefined) {
      updates.configJson = stableJson({
        ...parseJson(existing.configJson, {}),
        ...args.config,
      });
    }
    if (args.cursor !== undefined) {
      updates.cursorJson = stableJson({
        ...parseJson(existing.cursorJson, {}),
        ...args.cursor,
      });
    }
    await getDb()
      .update(schema.brainSources)
      .set(updates)
      .where(eq(schema.brainSources.id, args.id));
    const [source] = await getDb()
      .select()
      .from(schema.brainSources)
      .where(eq(schema.brainSources.id, args.id))
      .limit(1);
    return { source: serializeSource(source) };
  },
});
