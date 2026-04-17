import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

export default defineAction({
  description: "Get a single form by ID with all fields and settings.",
  schema: z.object({
    id: z.string().describe("Form ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("form", args.id);
    if (!access) {
      throw new Error(`Form ${args.id} not found`);
    }

    const row = access.resource as typeof schema.forms.$inferSelect;

    const db = getDb();
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, args.id));

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      slug: row.slug,
      fields: JSON.parse(row.fields) as FormField[],
      settings: JSON.parse(row.settings) as FormSettings,
      status: row.status,
      visibility: row.visibility,
      ownerEmail: row.ownerEmail,
      responseCount: count?.count ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});
