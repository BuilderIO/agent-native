import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "../db/index.js";

function makeId(owner: string, contact: string): string {
  return `${owner.toLowerCase()}:${contact.toLowerCase()}`;
}

/**
 * Increment contact frequency after sending an email.
 * Upserts a row for each recipient.
 */
export async function incrementSendFrequency(
  ownerEmail: string,
  recipients: { email: string; name?: string }[],
): Promise<void> {
  const now = Date.now();
  for (const r of recipients) {
    const id = makeId(ownerEmail, r.email);
    await db
      .insert(schema.contactFrequency)
      .values({
        id,
        ownerEmail: ownerEmail.toLowerCase(),
        contactEmail: r.email.toLowerCase(),
        contactName: r.name || "",
        sendCount: 1,
        receiveCount: 0,
        lastContactedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.contactFrequency.id,
        set: {
          sendCount: sql`${schema.contactFrequency.sendCount} + 1`,
          contactName: r.name || sql`${schema.contactFrequency.contactName}`,
          lastContactedAt: now,
        },
      });
  }
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
