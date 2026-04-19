import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Update a routing form's metadata, fields, rules, or fallback",
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    disabled: z.boolean().optional(),
    fields: z.array(z.any()).optional(),
    rules: z.array(z.any()).optional(),
    fallback: z.any().optional(),
  }),
  run: async (args) => {
    await assertAccess("routing-form", args.id, "editor");
    const { getDb, schema } = getSchedulingContext();
    const set: any = { updatedAt: new Date().toISOString() };
    if (args.name != null) set.name = args.name;
    if (args.description !== undefined)
      set.description = args.description ?? null;
    if (args.disabled != null) set.disabled = args.disabled;
    if (args.fields != null) set.fields = JSON.stringify(args.fields);
    if (args.rules != null) set.rules = JSON.stringify(args.rules);
    if (args.fallback !== undefined)
      set.fallback = args.fallback ? JSON.stringify(args.fallback) : null;
    await getDb()
      .update(schema.routingForms)
      .set(set)
      .where(eq(schema.routingForms.id, args.id));
    return { ok: true };
  },
});
