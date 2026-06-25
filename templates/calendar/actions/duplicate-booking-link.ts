import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeBookingDurationInput } from "../server/lib/booking-durations.js";
import { rowToBookingLink } from "../server/lib/booking-link-utils.js";
import type { BookingLink } from "../shared/api.js";

const durationSchema = z.coerce
  .number()
  .int()
  .min(5)
  .max(24 * 60);

const copySchema = z.object({
  title: z.string().min(1).optional().describe("Title for this copy"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .describe("Requested URL slug; reused if it already exists"),
  duration: durationSchema.optional().describe("Default duration in minutes"),
  durations: z
    .array(durationSchema)
    .optional()
    .describe("Optional duration choices, e.g. [30,45,60]"),
  description: z.string().optional().describe("Override description"),
});

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "booking-link"
  );
}

async function findAccessibleLinkBySlug(slug: string) {
  const rows = await getDb()
    .select()
    .from(schema.bookingLinks)
    .where(
      and(
        eq(schema.bookingLinks.slug, slug),
        accessFilter(schema.bookingLinks, schema.bookingLinkShares),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function slugIsReserved(slug: string): Promise<boolean> {
  const [links, redirects] = await Promise.all([
    // guard:allow-unscoped — public booking-link slugs are globally unique; existence-only check prevents URL collisions
    getDb()
      .select({ id: schema.bookingLinks.id })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.slug, slug))
      .limit(1),
    getDb()
      .select({ oldSlug: schema.bookingSlugRedirects.oldSlug })
      .from(schema.bookingSlugRedirects)
      .where(eq(schema.bookingSlugRedirects.oldSlug, slug))
      .limit(1),
  ]);
  return links.length > 0 || redirects.length > 0;
}

async function uniqueSlug(base: string): Promise<string> {
  const clean = slugify(base);
  if (!(await slugIsReserved(clean))) return clean;
  for (let i = 2; i < 100; i++) {
    const candidate = `${clean}-${i}`;
    if (!(await slugIsReserved(candidate))) return candidate;
  }
  return `${clean}-${nanoid(6).toLowerCase()}`;
}

export default defineAction({
  description:
    "Duplicate an existing booking link into one or more new booking links. Use this for requests like making 45 min, 1 hour, or multi-choice copies.",
  schema: z.object({
    sourceId: z.string().optional().describe("Existing booking link id"),
    sourceSlug: z.string().optional().describe("Existing booking link slug"),
    copies: z
      .array(copySchema)
      .min(1)
      .max(10)
      .describe("Copies to create from the source link"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    if (!args.sourceId && !args.sourceSlug) {
      throw new Error("sourceId or sourceSlug is required");
    }

    const access = accessFilter(schema.bookingLinks, schema.bookingLinkShares);
    const sourceRows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(
        and(
          args.sourceId
            ? eq(schema.bookingLinks.id, args.sourceId)
            : eq(schema.bookingLinks.slug, String(args.sourceSlug)),
          access,
        ),
      )
      .limit(1);
    const source = sourceRows[0];
    if (!source) throw new Error("Source booking link not found");

    const now = new Date().toISOString();
    const created: BookingLink[] = [];

    for (const copy of args.copies) {
      const requestedSlug = copy.slug
        ? slugify(copy.slug)
        : slugify(copy.title ?? `${source.slug}-copy`);
      const existing = await findAccessibleLinkBySlug(requestedSlug);
      if (existing) {
        created.push(rowToBookingLink(existing));
        continue;
      }

      const slug = await uniqueSlug(requestedSlug);
      const durations =
        copy.durations ??
        (copy.duration === undefined
          ? parseJson<number[]>(source.durations, [])
          : []);
      const durationInput = normalizeBookingDurationInput({
        duration: copy.duration ?? source.duration,
        durations,
      });
      if ("error" in durationInput) {
        throw new Error(durationInput.error);
      }
      const id = nanoid();

      await getDb()
        .insert(schema.bookingLinks)
        .values({
          id,
          slug,
          title: (copy.title ?? source.title).trim(),
          description:
            copy.description !== undefined
              ? copy.description.trim() || null
              : source.description,
          duration: durationInput.duration,
          durations: durationInput.durations
            ? JSON.stringify(durationInput.durations)
            : null,
          hosts: source.hosts,
          customFields: source.customFields,
          conferencing: source.conferencing,
          color: source.color,
          isActive: source.isActive,
          ownerEmail,
          orgId,
          visibility: source.visibility,
          createdAt: now,
          updatedAt: now,
        });

      const [row] = await getDb()
        .select()
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.id, id));
      created.push(rowToBookingLink(row));
    }

    return created;
  },
});
