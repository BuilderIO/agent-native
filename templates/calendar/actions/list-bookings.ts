import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { needsZoomCancellationReview } from "../server/lib/zoom.js";
import type { Booking } from "../shared/api.js";

function rowToBooking(
  row: Pick<
    typeof schema.bookings.$inferSelect,
    | "id"
    | "name"
    | "email"
    | "additionalGuestEmails"
    | "start"
    | "end"
    | "slug"
    | "eventTitle"
    | "notes"
    | "fieldResponses"
    | "meetingLink"
    | "meetingLinkPending"
    | "googleEventId"
    | "zoomNeedsReview"
    | "zoomMeetingId"
    | "zoomAccountId"
    | "status"
    | "createdAt"
  >,
  conferencing?: string | null,
): Booking {
  let fieldResponses: Record<string, string | boolean> | undefined;
  if (row.fieldResponses) {
    try {
      fieldResponses = JSON.parse(row.fieldResponses);
    } catch {}
  }
  const additionalGuestEmails = parseAdditionalGuestEmails(
    row.additionalGuestEmails,
  );
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    additionalGuestEmails,
    start: row.start,
    end: row.end,
    slug: row.slug,
    eventTitle: row.eventTitle ?? "",
    notes: row.notes ?? undefined,
    fieldResponses,
    meetingLink: row.meetingLink ?? undefined,
    meetingLinkPending:
      row.meetingLinkPending && !row.meetingLink ? true : undefined,
    googleEventId: row.googleEventId ?? undefined,
    zoomNeedsReview: row.zoomNeedsReview,
    zoomCancellationNeedsReview: needsZoomCancellationReview({
      ...row,
      conferencing,
    }),
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
      .select({
        slug: schema.bookingLinks.slug,
        conferencing: schema.bookingLinks.conferencing,
      })
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
    const slugs = accessibleLinks.map((link) => link.slug);
    if (slugs.length === 0) return [];
    const conferencingBySlug = new Map(
      accessibleLinks.map((link) => [link.slug, link.conferencing]),
    );

    const rows = await getDb()
      .select({
        id: schema.bookings.id,
        name: schema.bookings.name,
        email: schema.bookings.email,
        additionalGuestEmails: schema.bookings.additionalGuestEmails,
        start: schema.bookings.start,
        end: schema.bookings.end,
        slug: schema.bookings.slug,
        eventTitle: schema.bookings.eventTitle,
        notes: schema.bookings.notes,
        fieldResponses: schema.bookings.fieldResponses,
        meetingLink: schema.bookings.meetingLink,
        meetingLinkPending: schema.bookings.meetingLinkPending,
        googleEventId: schema.bookings.googleEventId,
        zoomNeedsReview: schema.bookings.zoomNeedsReview,
        zoomMeetingId: schema.bookings.zoomMeetingId,
        zoomAccountId: schema.bookings.zoomAccountId,
        status: schema.bookings.status,
        createdAt: schema.bookings.createdAt,
      })
      .from(schema.bookings)
      .where(inArray(schema.bookings.slug, slugs))
      .orderBy(schema.bookings.start);
    return rows.map((row) =>
      rowToBooking(row, conferencingBySlug.get(row.slug)),
    );
  },
});

function parseAdditionalGuestEmails(
  value: string | null | undefined,
): string[] | undefined {
  if (!value) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid stored additional guest emails");
  }
  const emails = parsed.filter(
    (email): email is string => typeof email === "string",
  );
  if (emails.length !== parsed.length) {
    throw new Error("Invalid stored additional guest emails");
  }
  return emails;
}
