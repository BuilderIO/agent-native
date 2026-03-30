import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import type { BookingLink } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";

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
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    duration: row.duration,
    durations,
    customFields,
    color: row.color ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const listBookingLinks = defineEventHandler(async (event: H3Event) => {
  try {
    const rows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .orderBy(desc(schema.bookingLinks.updatedAt));
    return rows.map(rowToBookingLink);
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const createBookingLink = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);

    if (!body.title || !body.slug || !body.duration) {
      setResponseStatus(event, 400);
      return { error: "title, slug, and duration are required" };
    }

    const slug = String(body.slug).trim().toLowerCase();
    const existing = await getDb()
      .select({ id: schema.bookingLinks.id })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.slug, slug));

    if (existing.length > 0) {
      setResponseStatus(event, 409);
      return { error: "A booking link with this slug already exists" };
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
        duration: Number(body.duration),
        durations: body.durations ? JSON.stringify(body.durations) : null,
        customFields: body.customFields
          ? JSON.stringify(body.customFields)
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
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const updateBookingLink = defineEventHandler(async (event: H3Event) => {
  try {
    const id = getRouterParam(event, "id");
    if (!id) {
      setResponseStatus(event, 400);
      return { error: "id is required" };
    }

    const body = await readBody(event);
    if (!body.title || !body.slug || !body.duration) {
      setResponseStatus(event, 400);
      return { error: "title, slug, and duration are required" };
    }

    const slug = String(body.slug).trim().toLowerCase();
    const existingSlug = await getDb()
      .select({ id: schema.bookingLinks.id })
      .from(schema.bookingLinks)
      .where(
        // ensure another record does not already own the slug
        eq(schema.bookingLinks.slug, slug),
      );

    if (existingSlug.some((row) => row.id !== id)) {
      setResponseStatus(event, 409);
      return { error: "A booking link with this slug already exists" };
    }

    await getDb()
      .update(schema.bookingLinks)
      .set({
        slug,
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : null,
        duration: Number(body.duration),
        durations: body.durations ? JSON.stringify(body.durations) : null,
        customFields: body.customFields
          ? JSON.stringify(body.customFields)
          : null,
        color: body.color ? String(body.color).trim() : null,
        isActive: body.isActive ?? true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookingLinks.id, id));

    const updated = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));

    if (updated.length === 0) {
      setResponseStatus(event, 404);
      return { error: "Booking link not found" };
    }

    return rowToBookingLink(updated[0]);
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const deleteBookingLink = defineEventHandler(async (event: H3Event) => {
  try {
    const id = getRouterParam(event, "id");
    if (!id) {
      setResponseStatus(event, 400);
      return { error: "id is required" };
    }

    await getDb()
      .delete(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));
    return { ok: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getPublicBookingLink = defineEventHandler(
  async (event: H3Event) => {
    try {
      const slug = getRouterParam(event, "slug");
      if (!slug) {
        setResponseStatus(event, 400);
        return { error: "slug is required" };
      }

      const rows = await getDb()
        .select()
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.slug, slug));

      if (rows.length === 0 || !rows[0].isActive) {
        setResponseStatus(event, 404);
        return { error: "Booking link not found" };
      }

      return rowToBookingLink(rows[0]);
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);
