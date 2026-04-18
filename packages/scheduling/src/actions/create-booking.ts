import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getEventTypeById,
  getEventTypeBySlug,
} from "../server/event-types-repo.js";
import { createBooking } from "../server/booking-service.js";
import { currentOrgId } from "./_helpers.js";

export default defineAction({
  description:
    "Create a booking. Either pass eventTypeId, or (ownerEmail|teamId)+slug.",
  schema: z.object({
    eventTypeId: z.string().optional(),
    slug: z.string().optional(),
    ownerEmail: z.string().optional(),
    teamId: z.string().optional(),
    startTime: z.string(),
    endTime: z.string(),
    timezone: z.string().default("UTC"),
    attendeeName: z.string(),
    attendeeEmail: z.string(),
    attendeeTimezone: z.string().optional(),
    guests: z
      .array(z.object({ name: z.string(), email: z.string() }))
      .optional(),
    customResponses: z.record(z.any()).optional(),
    description: z.string().optional(),
  }),
  run: async (args) => {
    const eventType = args.eventTypeId
      ? await getEventTypeById(args.eventTypeId)
      : args.slug
        ? await getEventTypeBySlug({
            slug: args.slug,
            ownerEmail: args.ownerEmail,
            teamId: args.teamId,
          })
        : null;
    if (!eventType) throw new Error("Event type not found");
    const hostEmail = args.ownerEmail ?? eventType.ownerEmail ?? "";
    if (!hostEmail) throw new Error("Cannot resolve host for booking");
    return {
      booking: await createBooking({
        eventType,
        hostEmail,
        startTime: args.startTime,
        endTime: args.endTime,
        timezone: args.timezone,
        attendee: {
          email: args.attendeeEmail,
          name: args.attendeeName,
          timezone: args.attendeeTimezone,
        },
        guests: args.guests?.map((g) => ({ email: g.email, name: g.name })),
        customResponses: args.customResponses,
        description: args.description,
        orgId: currentOrgId(),
      }),
    };
  },
});
