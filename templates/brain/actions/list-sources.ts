import { defineAction } from "@agent-native/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { serializeSource } from "../server/lib/brain.js";
import { sourceProviderSchema } from "./_schemas.js";

export default defineAction({
  description: "List Brain sources accessible to the current user.",
  schema: z.object({
    provider: sourceProviderSchema.optional(),
    includeArchived: z.coerce.boolean().default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider, includeArchived }) => {
    const clauses = [
      accessFilter(schema.brainSources, schema.brainSourceShares),
    ];
    if (provider) clauses.push(eq(schema.brainSources.provider, provider));
    if (!includeArchived)
      clauses.push(eq(schema.brainSources.status, "active"));
    const rows = await getDb()
      .select()
      .from(schema.brainSources)
      .where(and(...clauses))
      .orderBy(desc(schema.brainSources.updatedAt));
    return { count: rows.length, sources: rows.map(serializeSource) };
  },
});
