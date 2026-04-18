import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Create a host group within an event type",
  schema: z.object({
    eventTypeId: z.string(),
    name: z.string(),
    userEmails: z.array(z.string()).optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    const now = new Date().toISOString();
    await getDb().insert(schema.eventTypeHostGroups).values({
      id,
      eventTypeId: args.eventTypeId,
      name: args.name,
      createdAt: now,
    });
    return { id };
  },
});
