import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Read one email asset including its content blocks (JSON array of heading, text and button blocks).",
  schema: z.object({ id: z.string().min(1).describe("Email id") }),
  outputSchema: z.object({ email: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    await ready();
    const [row] = await getDb().select().from(schema.emails).where(eq(schema.emails.id, id));
    if (!row) return errors.noWrite("Email not found.", "not_found", { statusCode: 404 });
    return { email: row };
  },
});
