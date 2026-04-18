import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "Set the destination calendar for new events (optionally scoped to an event type)",
  schema: z.object({
    credentialId: z.string(),
    externalId: z.string(),
    eventTypeId: z.string().optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const cred = await getDb()
      .select()
      .from(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.id, args.credentialId));
    if (!cred[0]) throw new Error("Credential not found");
    await getDb()
      .delete(schema.destinationCalendars)
      .where(eq(schema.destinationCalendars.credentialId, args.credentialId));
    await getDb()
      .insert(schema.destinationCalendars)
      .values({
        id: nanoid(),
        credentialId: args.credentialId,
        userEmail: currentUserEmail(),
        integration: cred[0].type,
        externalId: args.externalId,
        eventTypeId: args.eventTypeId ?? null,
        createdAt: new Date().toISOString(),
      });
    return { ok: true };
  },
});
