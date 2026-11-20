import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Delete a token.",
  schema: z.object({ id: z.string().min(1).describe("token id") }),
  outputSchema: z.object({ deleted: z.literal(true) }),
  errors,
  run: async ({ id }) => {
    await ready();
    await getDb().delete(schema.tokens).where(eq(schema.tokens.id, id));
    return { deleted: true as const };
  },
});
