import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Revoke a private hashed link",
  schema: z.object({ hash: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const db = getDb();
    const [link] = await db
      .select({ eventTypeId: schema.hashedLinks.eventTypeId })
      .from(schema.hashedLinks)
      .where(eq(schema.hashedLinks.hash, args.hash))
      .limit(1);
    if (link) {
      await assertAccess("event-type", link.eventTypeId, "editor");
    }
    await db
      .delete(schema.hashedLinks)
      .where(eq(schema.hashedLinks.hash, args.hash));
    return { ok: true };
  },
});
