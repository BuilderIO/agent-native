import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Revoke a private hashed link",
  schema: z.object({ hash: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.hashedLinks)
      .where(eq(schema.hashedLinks.hash, args.hash));
    return { ok: true };
  },
});
