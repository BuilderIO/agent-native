import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeBookingDurationInput } from "../server/lib/booking-durations.js";
import {
  rowToBookingLink,
  serializeBookingHosts,
} from "../server/lib/booking-link-utils.js";

const durationSchema = z.coerce
  .number()
  .int()
  .min(5)
  .max(24 * 60);

const hostsSchema = z
  .union([
    z.array(
      z.union([
        z.string(),
        z.object({
          email: z.string(),
          displayName: z.string().optional(),
        }),
      ]),
    ),
    z.string(),
  ])
  .optional();

export default defineAction({
  description:
    "Update an existing booking link/event type, including required co-hosts.",
  schema: z.object({
    id: z.string().describe("Booking link id"),
    title: z.string().min(1).describe("Booking link title"),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .describe("URL slug, lowercase words separated by hyphens"),
    duration: durationSchema.describe("Default duration in minutes"),
    description: z.string().optional().describe("Description"),
    durations: z
      .array(durationSchema)
      .optional()
      .describe("Optional duration choices, e.g. [30,45,60]"),
    hosts: hostsSchema.describe(
      "Required co-hosts besides the owner. Accepts emails, comma-separated emails, or {email, displayName} objects.",
    ),
    customFields: z.array(z.any()).optional().describe("Custom form fields"),
    conferencing: z.any().optional().describe("Conferencing configuration"),
    color: z.string().optional().describe("Display color"),
    isActive: z.boolean().optional().describe("Whether the link is active"),
  }),
  run: async (args) => {
    await assertAccess("booking-link", args.id, "editor");

    const durationInput = normalizeBookingDurationInput({
      duration: args.duration,
      durations: args.durations,
    });
    if ("error" in durationInput) {
      throw new Error(durationInput.error);
    }

    const slug = args.slug.trim().toLowerCase();
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

    if (existingSlug.some((row) => row.id !== args.id)) {
      throw new Error("A booking link with this slug already exists");
    }
    if (existingRedirect.length > 0) {
      throw new Error("A booking link with this slug already exists");
    }

    const [current] = await getDb()
      .select({
        slug: schema.bookingLinks.slug,
        ownerEmail: schema.bookingLinks.ownerEmail,
      })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, args.id));

    if (!current) throw new Error("Booking link not found");
    const oldSlug = current.slug;
    const slugChanged = oldSlug !== slug;

    await getDb()
      .update(schema.bookingLinks)
      .set({
        slug,
        title: args.title.trim(),
        description: args.description ? args.description.trim() : null,
        duration: durationInput.duration,
        durations: durationInput.durations
          ? JSON.stringify(durationInput.durations)
          : null,
        hosts: serializeBookingHosts(args.hosts, current.ownerEmail),
        customFields: args.customFields
          ? JSON.stringify(args.customFields)
          : null,
        conferencing: args.conferencing
          ? JSON.stringify(args.conferencing)
          : null,
        color: args.color ? args.color.trim() : null,
        isActive: args.isActive ?? true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookingLinks.id, args.id));

    if (slugChanged) {
      const now = new Date().toISOString();
      await getDb().insert(schema.bookingSlugRedirects).values({
        oldSlug,
        newSlug: slug,
        createdAt: now,
      });
      await getDb()
        .update(schema.bookingSlugRedirects)
        .set({ newSlug: slug })
        .where(eq(schema.bookingSlugRedirects.newSlug, oldSlug));
    }

    const [updated] = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, args.id));

    if (!updated) throw new Error("Booking link not found");
    return rowToBookingLink(updated);
  },
});
