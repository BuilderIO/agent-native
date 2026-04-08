import { defineAction } from "@agent-native/core";
import { eq, desc, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type { FormResponse } from "../shared/types.js";

export default defineAction({
  description: "List responses for a form.",
  parameters: {
    formId: { type: "string", description: "Form ID (required)" },
    limit: {
      type: "string",
      description: "Max responses to return (default 100)",
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const formId = args.formId || args.form;
    if (!formId) {
      throw new Error("--formId is required");
    }

    const db = getDb();
    const form = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, formId))
      .get();

    if (!form) {
      throw new Error(`Form ${formId} not found`);
    }

    const limit = parseInt(args.limit || "100", 10);
    const rows = await db
      .select()
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .orderBy(desc(schema.responses.submittedAt))
      .limit(limit)
      .all();

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .get();

    return {
      responses: rows.map((r) => ({
        id: r.id,
        formId: r.formId,
        data: JSON.parse(r.data),
        submittedAt: r.submittedAt,
      })) as FormResponse[],
      total: total?.count ?? 0,
      fields: JSON.parse(form.fields),
    };
  },
});
