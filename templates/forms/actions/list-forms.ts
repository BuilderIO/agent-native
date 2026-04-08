import { defineAction } from "@agent-native/core";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

export default defineAction({
  description: "List all forms with response counts.",
  parameters: {
    status: {
      type: "string",
      description: "Filter by status: draft, published, or closed",
      enum: ["draft", "published", "closed"],
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.forms)
      .orderBy(schema.forms.updatedAt)
      .all();

    const counts = await db
      .select({
        formId: schema.responses.formId,
        count: sql<number>`count(*)`,
      })
      .from(schema.responses)
      .groupBy(schema.responses.formId)
      .all();
    const countMap = new Map(counts.map((c) => [c.formId, c.count]));

    let forms = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      slug: r.slug,
      fields: JSON.parse(r.fields) as FormField[],
      settings: JSON.parse(r.settings) as FormSettings,
      status: r.status,
      responseCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    if (args.status) {
      forms = forms.filter((f) => f.status === args.status);
    }

    return forms.reverse();
  },
});
