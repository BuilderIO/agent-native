import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeBookingDurationInput } from "../server/lib/booking-durations.js";
import {
  rowToBookingLink,
  serializeBookingHosts,
} from "../server/lib/booking-link-utils.js";

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
    "Create a new booking link/event type. Use this instead of raw SQL for booking links.",
  schema: z.object({
    title: z.string().min(1).describe("Booking link title"),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .describe("URL slug, lowercase words separated by hyphens"),
    duration: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .describe("Default duration in minutes"),
    description: z.string().optional().describe("Description"),
    durations: z
      .array(
        z.coerce
          .number()
          .int()
          .min(5)
          .max(24 * 60),
      )
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
    const body = args as Record<string, any>;
    const durationInput = normalizeBookingDurationInput({
      duration: body.duration,
      durations: body.durations,
    });
    if ("error" in durationInput) {
      throw new Error(durationInput.error);
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
    const ownerEmail = (() => {
      const e = getRequestUserEmail();
      if (!e) throw new Error("no authenticated user");
      return e;
    })();
    await getDb()
      .insert(schema.bookingLinks)
      .values({
        id,
        slug,
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : null,
        duration: durationInput.duration,
        durations: durationInput.durations
          ? JSON.stringify(durationInput.durations)
          : null,
        hosts: serializeBookingHosts(body.hosts, ownerEmail),
        customFields: body.customFields
          ? JSON.stringify(body.customFields)
          : null,
        conferencing: body.conferencing
          ? JSON.stringify(body.conferencing)
          : null,
        color: body.color ? String(body.color).trim() : null,
        isActive: body.isActive ?? true,
        ownerEmail,
        orgId: getRequestOrgId(),
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
