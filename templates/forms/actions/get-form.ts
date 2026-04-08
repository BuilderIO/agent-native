import { defineAction } from "@agent-native/core";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

export default defineAction({
  description: "Get a single form by ID with all fields and settings.",
  parameters: {
    id: { type: "string", description: "Form ID" },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) {
      throw new Error("--id is required");
    }

    const db = getDb();
    const row = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .get();

    if (!row) {
      throw new Error(`Form ${args.id} not found`);
    }

    const count = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, args.id))
      .get();

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      slug: row.slug,
      fields: JSON.parse(row.fields) as FormField[],
      settings: JSON.parse(row.settings) as FormSettings,
      status: row.status,
      responseCount: count?.count ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});
