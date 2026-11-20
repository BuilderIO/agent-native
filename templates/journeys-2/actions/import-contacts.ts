import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Import contacts from parsed CSV rows. Rows with an existing email are updated; new emails are created. Rows without a valid email are skipped and counted.",
  schema: z.object({
    rows: z.array(z.object({
      email: z.string().describe("Email address"),
      name: z.string().optional().describe("Full name"),
      title: z.string().optional().describe("Job title"),
      country: z.string().optional().describe("Country"),
      company: z.string().optional().describe("Company name; matched to an existing account if possible"),
    })).min(1).max(1000).describe("Rows to import"),
  }),
  outputSchema: z.object({ created: z.number(), updated: z.number(), skipped: z.number() }),
  errors,
  run: async ({ rows }) => {
    await ready();
    const db = getDb();
    const [existing, accounts] = await Promise.all([db.select().from(schema.contacts), db.select().from(schema.accounts)]);
    const byEmail = new Map<string, string>(existing.map((c) => [c.email.toLowerCase(), c.id]));
    const accountByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a.id]));
    const now = nowIso();
    let created = 0, updated = 0, skipped = 0;
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
      const accountId = row.company ? accountByName.get(row.company.toLowerCase()) ?? null : null;
      const prior = byEmail.get(email);
      if (prior !== undefined) {
        await db.update(schema.contacts).set({ ...(row.name && { name: row.name }), ...(row.title && { title: row.title }), ...(row.country && { country: row.country }), ...(accountId && { accountId }), updatedAt: now }).where(eq(schema.contacts.id, prior));
        updated++;
      } else {
        const id = newId("c");
        await db.insert(schema.contacts).values({ id, email, name: row.name || email.split("@")[0]!, title: row.title ?? "", country: row.country ?? "", accountId, source: "Import", createdAt: now, updatedAt: now });
        byEmail.set(email, id);
        created++;
      }
    }
    return { created, updated, skipped };
  },
});

