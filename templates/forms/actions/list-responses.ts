import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import type { FormResponse } from "../shared/types.js";

export default defineAction({
  description: "List responses for a form.",
  schema: z
    .object({
      formId: z.string().optional().describe("Form ID"),
      form: z.string().optional().describe("Form ID (legacy alias for formId)"),
      limit: z.coerce
        .number()
        .optional()
        .default(100)
        .describe("Max responses to return (default 100)"),
    })
    .refine((args) => args.formId || args.form, {
      message: "formId is required",
    }),
  http: { method: "GET" },
  run: async (args) => {
    const formId = args.formId ?? args.form;
    if (!formId) throw new Error("formId is required");

    const access = await resolveAccess("form", formId);
    if (!access) throw new Error(`Form ${formId} not found`);

    const db = getDb();
    const [form] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, formId))
      .limit(1);

    if (!form) {
      throw new Error(`Form ${formId} not found`);
    }

    const limit = args.limit;
    const rows = await db
      .select()
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .orderBy(desc(schema.responses.submittedAt))
      .limit(limit);

    const [total] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId));

    return {
      responses: rows.map((r) => ({
        id: r.id,
        formId: r.formId,
        data: JSON.parse(r.data),
        submittedAt: r.submittedAt,
      })) as FormResponse[],
      total: (total as any)?.count ?? 0,
      fields: JSON.parse(form.fields),
    };
  },
});
