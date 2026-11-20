import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Permanently delete a journey, its members and send stats. Confirm with the user first.",
  schema: z.object({ id: z.string().min(1).describe("Journey id") }),
  outputSchema: z.object({ deleted: z.literal(true) }),
  errors,
  run: async ({ id }) => {
    await ready();
    const db = getDb();
    await db.delete(schema.members).where(eq(schema.members.journeyId, id));
    await db.delete(schema.sends).where(eq(schema.sends.journeyId, id));
    await db.delete(schema.journeys).where(eq(schema.journeys.id, id));
    return { deleted: true as const };
  },
});
