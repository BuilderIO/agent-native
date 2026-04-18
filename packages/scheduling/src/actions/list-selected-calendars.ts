import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { getCalendarProvider } from "../server/providers/registry.js";

export default defineAction({
  description:
    "List all calendars a credential has access to, with selected flag",
  schema: z.object({ credentialId: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const cred = await getDb()
      .select()
      .from(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.id, args.credentialId));
    if (!cred[0]) throw new Error("Credential not found");
    const provider = getCalendarProvider(cred[0].type);
    if (!provider) throw new Error(`No provider for ${cred[0].type}`);
    const all = await provider.listCalendars({
      credentialId: args.credentialId,
    });
    const selected = await getDb()
      .select({ externalId: schema.selectedCalendars.externalId })
      .from(schema.selectedCalendars)
      .where(eq(schema.selectedCalendars.credentialId, args.credentialId));
    const selectedSet = new Set(selected.map((r: any) => r.externalId));
    const destination = await getDb()
      .select({ externalId: schema.destinationCalendars.externalId })
      .from(schema.destinationCalendars)
      .where(eq(schema.destinationCalendars.credentialId, args.credentialId));
    const destinationId = destination[0]?.externalId;
    return {
      calendars: all.map((c) => ({
        ...c,
        isSelected: selectedSet.has(c.externalId),
        isDestination: c.externalId === destinationId,
      })),
    };
  },
});
