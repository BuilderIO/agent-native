import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { Booking } from "../shared/api.js";

function rowToBooking(
  row: Pick<
    typeof schema.bookings.$inferSelect,
    | "id"
    | "name"
    | "email"
    | "start"
    | "end"
    | "slug"
    | "eventTitle"
    | "notes"
    | "fieldResponses"
    | "meetingLink"
    | "googleEventId"
    | "status"
    | "createdAt"
  >,
): Booking {
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
    eventTitle: row.eventTitle ?? "",
    notes: row.notes ?? undefined,
    fieldResponses,
    meetingLink: row.meetingLink ?? undefined,
    googleEventId: row.googleEventId ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export default defineAction({
  description: "List all bookings",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const accessibleLinks = await getDb()
      .select({ slug: schema.bookingLinks.slug })
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
    const slugs = accessibleLinks.map((link) => link.slug);
    if (slugs.length === 0) return [];

    const rows = await getDb()
      .select({
        id: schema.bookings.id,
        name: schema.bookings.name,
        email: schema.bookings.email,
        start: schema.bookings.start,
        end: schema.bookings.end,
        slug: schema.bookings.slug,
        eventTitle: schema.bookings.eventTitle,
        notes: schema.bookings.notes,
        fieldResponses: schema.bookings.fieldResponses,
        meetingLink: schema.bookings.meetingLink,
        googleEventId: schema.bookings.googleEventId,
        status: schema.bookings.status,
        createdAt: schema.bookings.createdAt,
      })
      .from(schema.bookings)
      .where(inArray(schema.bookings.slug, slugs))
      .orderBy(schema.bookings.start);
    return rows.map(rowToBooking);
  },
});
