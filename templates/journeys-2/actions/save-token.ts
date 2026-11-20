import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready , defined } from "../server/core.js";

export default defineAction({
  description: "Create (omit id) or update (pass id) a token. A token reads a contact field (source, e.g. name, country, account.plan), maps values through rules [{when, then}], and uses fallback when nothing matches.",
  schema: z.object({
    id: z.string().optional().describe("Token id to update; omit to create"),
    name: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60).optional().describe("snake_case token name"),
    kind: z.enum(["text", "number", "date", "boolean"]).optional().describe("Output type"),
    source: z.string().max(100).optional().describe("Contact or account field to read"),
    fallback: z.string().max(300).optional().describe("Value when the field is empty or no rule matches"),
    rules: z.array(z.object({ when: z.string(), then: z.string() })).optional().describe("Value mapping rules"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, ...fields }) => {
    await ready();
    const now = nowIso();
    if (!id) {
      if (!fields.name) return errors.noWrite("A token needs a name.", "invalid_input");
      const newTokenId = newId("tok");
      await getDb().insert(schema.tokens).values({ ...defined(fields), name: fields.name, id: newTokenId, createdAt: now, updatedAt: now });
      return { id: newTokenId };
    }
    const rows = await getDb().update(schema.tokens).set({ ...defined(fields), updatedAt: now }).where(eq(schema.tokens.id, id)).returning({ id: schema.tokens.id });
    if (rows.length === 0) return errors.noWrite("Token not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
