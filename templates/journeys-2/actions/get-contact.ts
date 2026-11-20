import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Read one contact: properties, account, activity counts, static list memberships and journeys they have been in.",
  schema: z.object({ id: z.string().min(1).describe("Contact id") }),
  outputSchema: z.object({ contact: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    await ready();
    const db = getDb();
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!c) return errors.noWrite("Contact not found.", "not_found", { statusCode: 404 });
    const [account] = c.accountId ? await db.select().from(schema.accounts).where(eq(schema.accounts.id, c.accountId)) : [];
    const memberships = await db.select().from(schema.members).where(eq(schema.members.contactId, id));
    const journeys = await db.select({ id: schema.journeys.id, name: schema.journeys.name }).from(schema.journeys);
    const names = new Map(journeys.map((j) => [j.id, j.name]));
    return { contact: { ...c, account: account ?? null, journeys: memberships.map((m) => ({ journeyId: m.journeyId, name: names.get(m.journeyId) ?? m.journeyId, status: m.status, enteredAt: m.enteredAt, exitedAt: m.exitedAt })) } };
  },
});
