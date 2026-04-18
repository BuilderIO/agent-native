import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Create a private hashed link for an event type",
  schema: z.object({
    eventTypeId: z.string(),
    expiresAt: z.string().optional(),
    isSingleUse: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    const hash = nanoid(24);
    await getDb()
      .insert(schema.hashedLinks)
      .values({
        id,
        hash,
        eventTypeId: args.eventTypeId,
        expiresAt: args.expiresAt ?? null,
        isSingleUse: args.isSingleUse ?? false,
        createdAt: new Date().toISOString(),
      });
    return { id, hash };
  },
});
