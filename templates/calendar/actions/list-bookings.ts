import { defineAction } from "@agent-native/core";
import { inArray } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import type { Booking } from "../shared/api.js";
import { getDb, schema } from "../server/db/index.js";

function rowToBooking(row: typeof schema.bookings.$inferSelect): Booking {
  let fieldResponses: Record<string, string | boolean> | undefined;
  if (row.fieldResponses) {
    try {
      fieldResponses = JSON.parse(row.fieldResponses);
    } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    start: row.start,
    end: row.end,
    slug: row.slug,
    eventTitle: row.eventTitle ?? undefined,
    notes: row.notes ?? undefined,
    fieldResponses,
    meetingLink: row.meetingLink ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export default defineAction({
  description: "List all bookings",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const accessibleLinks = await getDb()
      .select({ slug: schema.bookingLinks.slug })
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
    const slugs = accessibleLinks.map((link) => link.slug);
    if (slugs.length === 0) return [];

    const rows = await getDb()
      .select()
      .from(schema.bookings)
      .where(inArray(schema.bookings.slug, slugs))
      .orderBy(schema.bookings.start);
    return rows.map(rowToBooking);
  },
});
