import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, serializeSource } from "../server/lib/brain.js";

export default defineAction({
  description:
    "Archive a Brain source. This is a soft delete so captures and knowledge remain auditable.",
  schema: z.object({
    id: z.string().min(1),
  }),
  http: { method: "DELETE" },
  run: async ({ id }) => {
    await assertAccess("brain-source", id, "admin");
    await getDb()
      .update(schema.brainSources)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(eq(schema.brainSources.id, id));
    const [source] = await getDb()
      .select()
      .from(schema.brainSources)
      .where(eq(schema.brainSources.id, id))
      .limit(1);
    return { source: serializeSource(source) };
  },
});
