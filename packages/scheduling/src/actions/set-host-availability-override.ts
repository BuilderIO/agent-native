import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description:
    "Set a host-specific availability schedule override for an event type",
  schema: z.object({
    eventTypeId: z.string(),
    userEmail: z.string(),
    scheduleId: z.string().nullable(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .update(schema.eventTypeHosts)
      .set({ scheduleId: args.scheduleId })
      .where(
        and(
          eq(schema.eventTypeHosts.eventTypeId, args.eventTypeId),
          eq(schema.eventTypeHosts.userEmail, args.userEmail),
        ),
      );
    return { ok: true };
  },
});
