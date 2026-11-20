import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Delete an email asset. Journey steps that use it will need another email before publishing.",
  schema: z.object({ id: z.string().min(1).describe("Email id") }),
  outputSchema: z.object({ deleted: z.literal(true) }),
  errors,
  run: async ({ id }) => {
    await ready();
    await getDb().delete(schema.emails).where(eq(schema.emails.id, id));
    return { deleted: true as const };
  },
});
