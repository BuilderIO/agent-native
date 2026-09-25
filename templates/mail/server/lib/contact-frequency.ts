import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "../db/index.js";

function makeId(owner: string, contact: string): string {
  return `${owner.toLowerCase()}:${contact.toLowerCase()}`;
}

/**
 * Increment contact frequency after sending an email.
 * Upserts a row for each recipient in a single batched statement.
 */
export async function incrementSendFrequency(
  ownerEmail: string,
  recipients: { email: string; name?: string }[],
): Promise<void> {
  if (recipients.length === 0) return;

  const now = Date.now();

  // De-dupe by conflict key (id), summing send counts for repeated emails.
  // A single multi-row insert can't target the same conflict key twice —
  // Postgres raises "ON CONFLICT DO UPDATE command cannot affect row a
  // second time" — so recipients appearing more than once in one call must
  // be merged before the insert.
  const byId = new Map<
    string,
    { id: string; contactEmail: string; contactName: string; sendCount: number }
  >();
  for (const r of recipients) {
    const id = makeId(ownerEmail, r.email);
    const existing = byId.get(id);
    if (existing) {
      existing.sendCount += 1;
      if (r.name) existing.contactName = r.name;
    } else {
      byId.set(id, {
        id,
        contactEmail: r.email.toLowerCase(),
        contactName: r.name || "",
        sendCount: 1,
      });
    }
  }

  const values = Array.from(byId.values()).map((r) => ({
    id: r.id,
    ownerEmail: ownerEmail.toLowerCase(),
    contactEmail: r.contactEmail,
    contactName: r.contactName,
    sendCount: r.sendCount,
    receiveCount: 0,
    lastContactedAt: now,
  }));

  await db
    .insert(schema.contactFrequency)
    .values(values)
    .onConflictDoUpdate({
      target: schema.contactFrequency.id,
      set: {
        sendCount: sql`${schema.contactFrequency.sendCount} + excluded.send_count`,
        contactName: sql`case when excluded.contact_name != '' then excluded.contact_name else ${schema.contactFrequency.contactName} end`,
        lastContactedAt: sql`excluded.last_contacted_at`,
      },
    });
}

/**
 * Get contact frequency map for a user.
 * Returns a map of lowercase email → total interaction count.
 */
export async function getContactFrequencyMap(
  ownerEmail: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      contactEmail: schema.contactFrequency.contactEmail,
      sendCount: schema.contactFrequency.sendCount,
      receiveCount: schema.contactFrequency.receiveCount,
    })
    .from(schema.contactFrequency)
    .where(eq(schema.contactFrequency.ownerEmail, ownerEmail.toLowerCase()))
    .orderBy(desc(schema.contactFrequency.lastContactedAt));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.contactEmail, row.sendCount + row.receiveCount);
  }
  return map;
}
