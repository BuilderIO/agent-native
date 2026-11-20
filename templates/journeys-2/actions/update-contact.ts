import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready , defined } from "../server/core.js";

export default defineAction({
  description: "Edit a contact's properties, subscription status or lifecycle stage, or add/remove it from static lists (pass the complete lists array of audience ids).",
  schema: z.object({
    id: z.string().min(1).describe("Contact id"),
    name: z.string().max(200).optional().describe("Full name"),
    title: z.string().max(200).optional().describe("Job title"),
    country: z.string().max(100).optional().describe("Country"),
    state: z.string().max(100).optional().describe("State or region"),
    lifecycleStage: z.string().max(100).optional().describe("Lifecycle stage"),
    subscribed: z.boolean().optional().describe("Whether the contact can receive marketing email"),
    lists: z.array(z.string()).optional().describe("Complete static list ids"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, subscribed, ...fields }) => {
    await ready();
    const rows = await getDb().update(schema.contacts).set({ ...defined(fields), ...(subscribed !== undefined && { subscribed: subscribed ? 1 : 0 }), updatedAt: nowIso() }).where(eq(schema.contacts.id, id)).returning({ id: schema.contacts.id });
    if (rows.length === 0) return errors.noWrite("Contact not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
