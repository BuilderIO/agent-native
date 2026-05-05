import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

export default defineAction({
  description:
    "List forms with response counts. Hides soft-deleted forms by default; pass `--archived` to list those instead.",
  schema: z.object({
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("Filter by status: draft, published, or closed"),
    archived: z.coerce
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, return only soft-deleted forms (the Archive). Default false.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.forms)
      .where(accessFilter(schema.forms, schema.formShares))
      .orderBy(schema.forms.updatedAt);

    const counts = await db
      .select({
        formId: schema.responses.formId,
        count: sql<number>`count(*)`,
      })
      .from(schema.responses)
      .groupBy(schema.responses.formId);
    const countMap = new Map(counts.map((c) => [c.formId, c.count]));

    let forms = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      slug: r.slug,
      fields: JSON.parse(r.fields) as FormField[],
      settings: JSON.parse(r.settings) as FormSettings,
      status: r.status,
      visibility: r.visibility,
      ownerEmail: r.ownerEmail,
      responseCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt ?? null,
    }));

    forms = args.archived
      ? forms.filter((f) => f.deletedAt !== null)
      : forms.filter((f) => f.deletedAt === null);

    if (args.status) {
      forms = forms.filter((f) => f.status === args.status);
    }

    return forms.reverse();
  },
});
