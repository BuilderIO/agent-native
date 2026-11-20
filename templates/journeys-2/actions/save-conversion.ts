import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready , defined } from "../server/core.js";

export default defineAction({
  description: "Create (omit id) or update (pass id) a conversion goal: the event that counts as success within windowDays of entering a journey.",
  schema: z.object({
    id: z.string().optional().describe("Conversion id to update; omit to create"),
    name: z.string().min(1).max(200).optional().describe("Conversion name"),
    eventType: z.string().max(100).optional().describe("Event key, e.g. form_submitted, invited_teammate, pricing_viewed"),
    windowDays: z.number().int().min(1).max(365).optional().describe("Attribution window in days"),
    journeyId: z.string().nullish().describe("Journey this conversion is measured on"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, ...fields }) => {
    await ready();
    const now = nowIso();
    if (!id) {
      if (!fields.name || !fields.eventType) return errors.noWrite("A conversion needs a name and event type.", "invalid_input");
      const newConversionId = newId("cv");
      await getDb().insert(schema.conversions).values({ ...defined(fields), name: fields.name, eventType: fields.eventType, id: newConversionId, createdAt: now, updatedAt: now });
      return { id: newConversionId };
    }
    const rows = await getDb().update(schema.conversions).set({ ...defined(fields), updatedAt: now }).where(eq(schema.conversions.id, id)).returning({ id: schema.conversions.id });
    if (rows.length === 0) return errors.noWrite("Conversion not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
