import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import type { BookingLink } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { readBody } from "@agent-native/core/server";

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
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const listBookingLinks = defineEventHandler(async (event: H3Event) => {
  try {
    const rows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares))
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
        conferencing: body.conferencing
          ? JSON.stringify(body.conferencing)
          : null,
        color: body.color ? String(body.color).trim() : null,
        isActive: body.isActive ?? true,
        ownerEmail: getRequestUserEmail() ?? "local@localhost",
        orgId: getRequestOrgId(),
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

    // Sharing: only owner / editor / admin can update.
    await assertAccess("booking-link", id, "editor");

    const slug = String(body.slug).trim().toLowerCase();
    const [existingSlug, existingRedirect] = await Promise.all([
      getDb()
        .select({ id: schema.bookingLinks.id })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.slug, slug)),
      getDb()
        .select({ oldSlug: schema.bookingSlugRedirects.oldSlug })
        .from(schema.bookingSlugRedirects)
        .where(eq(schema.bookingSlugRedirects.oldSlug, slug)),
    ]);

    if (existingSlug.some((row) => row.id !== id)) {
      setResponseStatus(event, 409);
      return { error: "A booking link with this slug already exists" };
    }
    if (existingRedirect.length > 0) {
      setResponseStatus(event, 409);
      return { error: "A booking link with this slug already exists" };
    }

    // Fetch current slug to detect changes
    const current = await getDb()
      .select({ slug: schema.bookingLinks.slug })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));

    if (current.length === 0) {
      setResponseStatus(event, 404);
      return { error: "Booking link not found" };
    }

    const oldSlug = current[0].slug;
    const slugChanged = oldSlug !== slug;

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
        conferencing: body.conferencing
          ? JSON.stringify(body.conferencing)
          : null,
        color: body.color ? String(body.color).trim() : null,
        isActive: body.isActive ?? true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookingLinks.id, id));

    // Create redirect from old slug and repoint any existing redirects
    if (slugChanged) {
      const now = new Date().toISOString();
      await getDb().insert(schema.bookingSlugRedirects).values({
        oldSlug,
        newSlug: slug,
        createdAt: now,
      });
      // Chain: any redirects pointing to the old slug now point to the new one
      await getDb()
        .update(schema.bookingSlugRedirects)
        .set({ newSlug: slug })
        .where(eq(schema.bookingSlugRedirects.newSlug, oldSlug));
    }

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
    const status = error?.statusCode ?? 500;
    setResponseStatus(event, status);
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

    // Sharing: only owner / admin grantees can delete.
    await assertAccess("booking-link", id, "admin");

    // Get the slug before deleting so we can clean up redirects
    const toDelete = await getDb()
      .select({ slug: schema.bookingLinks.slug })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));

    await getDb()
      .delete(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, id));

    // Clean up redirects that point to the deleted link's slug
    if (toDelete.length > 0) {
      await getDb()
        .delete(schema.bookingSlugRedirects)
        .where(eq(schema.bookingSlugRedirects.newSlug, toDelete[0].slug));
    }

    return { ok: true };
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: error.message };
  }
});

// PUBLIC booking page — unauthenticated visitors fetch a link by slug to book.
// This is the anonymous-booking axis and MUST NOT apply the sharing filter.
// Sharing controls who can MANAGE the link; the public slug controls who can
// BOOK via the link (gated only by `isActive` + explicit publish).
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
        // Check if there's a redirect for this slug
        const redirect = await getDb()
          .select({ newSlug: schema.bookingSlugRedirects.newSlug })
          .from(schema.bookingSlugRedirects)
          .where(eq(schema.bookingSlugRedirects.oldSlug, slug));

        if (redirect.length > 0) {
          return { redirect: redirect[0].newSlug };
        }

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
