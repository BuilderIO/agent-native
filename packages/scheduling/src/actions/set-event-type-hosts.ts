import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Set the hosts assigned to an event type",
  schema: z.object({
    eventTypeId: z.string(),
    hosts: z.array(
      z.object({
        userEmail: z.string(),
        isFixed: z.boolean().optional().default(false),
        weight: z.number().optional().default(1),
        priority: z.number().optional().default(2),
        scheduleId: z.string().optional(),
      }),
    ),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const now = new Date().toISOString();
    await getDb()
      .delete(schema.eventTypeHosts)
      .where(eq(schema.eventTypeHosts.eventTypeId, args.eventTypeId));
    for (const h of args.hosts) {
      await getDb()
        .insert(schema.eventTypeHosts)
        .values({
          eventTypeId: args.eventTypeId,
          userEmail: h.userEmail,
          isFixed: h.isFixed ?? false,
          weight: h.weight ?? 1,
          priority: h.priority ?? 2,
          scheduleId: h.scheduleId ?? null,
          createdAt: now,
        });
    }
    return { ok: true };
  },
});
