import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Disconnect a calendar credential",
  schema: z.object({ credentialId: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.selectedCalendars)
      .where(eq(schema.selectedCalendars.credentialId, args.credentialId));
    await getDb()
      .delete(schema.destinationCalendars)
      .where(eq(schema.destinationCalendars.credentialId, args.credentialId));
    await getDb()
      .delete(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.id, args.credentialId));
    return { ok: true };
  },
});
