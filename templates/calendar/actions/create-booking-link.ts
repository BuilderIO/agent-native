import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { BookingLink } from "../shared/api.js";
import { getDb, schema } from "../server/db/index.js";

function rowToBookingLink(
  row: typeof schema.bookingLinks.$inferSelect,
): BookingLink {
  let durations: number[] | undefined;
  if (row.durations) {
    try {
      durations = JSON.parse(row.durations);
    } catch {}
  }
  let customFields: BookingLink["customFields"];
  if (row.customFields) {
    try {
      customFields = JSON.parse(row.customFields);
    } catch {}
  }
  let conferencing: BookingLink["conferencing"];
  if (row.conferencing) {
    try {
      conferencing = JSON.parse(row.conferencing);
    } catch {}
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    duration: row.duration,
    durations,
    customFields,
    conferencing,
    color: row.color ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export default defineAction({
  description: "Create a new booking link",
  schema: z.object({
    title: z.string().optional().describe("Booking link title (required)"),
    slug: z.string().optional().describe("URL slug (required)"),
    duration: z.coerce
      .number()
      .optional()
      .describe("Default duration in minutes (required)"),
    description: z.string().optional().describe("Description"),
  }),
  run: async (args) => {
    const body = args as Record<string, any>;

    if (!body.title || !body.slug || !body.duration) {
      throw new Error("title, slug, and duration are required");
    }

    const slug = String(body.slug).trim().toLowerCase();
    const [existingLink, existingRedirect] = await Promise.all([
      getDb()
        .select({ id: schema.bookingLinks.id })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.slug, slug)),
      getDb()
        .select({ oldSlug: schema.bookingSlugRedirects.oldSlug })
        .from(schema.bookingSlugRedirects)
        .where(eq(schema.bookingSlugRedirects.oldSlug, slug)),
    ]);

    if (existingLink.length > 0 || existingRedirect.length > 0) {
      throw new Error("A booking link with this slug already exists");
    }

    const now = new Date().toISOString();
    const id = nanoid();
    await getDb()
      .insert(schema.bookingLinks)
      .values({
        id,
        slug,
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : null,
        duration: body.duration,
        durations: body.durations ? JSON.stringify(body.durations) : null,
        customFields: body.customFields
          ? JSON.stringify(body.customFields)
          : null,
        conferencing: body.conferencing
          ? JSON.stringify(body.conferencing)
          : null,
        color: body.color ? String(body.color).trim() : null,
        isActive: body.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      });

    const created = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));
    return rowToBookingLink(created[0]);
  },
});
