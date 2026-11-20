import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Update a settings group by merging fields. email: defaultFromName, defaultFromEmail, defaultReplyTo, maxEmailsPerDay, maxEmailsPerWeek, footerAddress, unsubscribeUrl. utm: source, medium, campaign, content, term, appendToAllLinks.",
  schema: z.object({
    group: z.enum(["email", "utm"]).describe("Settings group"),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe("Fields to merge"),
  }),
  outputSchema: z.object({ value: z.record(z.string(), z.unknown()) }),
  errors,
  run: async ({ group, values }) => {
    await ready();
    const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.key, group));
    const value = { ...(row?.value as object | undefined), ...values };
    await getDb().insert(schema.settings).values({ key: group, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
    return { value };
  },
});
