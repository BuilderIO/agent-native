import { defineAction } from "@agent-native/core";
import { emit } from "@agent-native/core/event-bus";
import { z } from "zod";
import {
  getEventTypeById,
  getEventTypeBySlug,
  createBooking,
} from "@agent-native/scheduling/server";
import { currentOrgId } from "@agent-native/scheduling/actions/_helpers";

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
    customResponses: z.record(z.string(), z.any()).optional(),
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
    const booking = await createBooking({
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
    });

    try {
      emit(
        "calendar.booking.created",
        {
          bookingId: booking.id ?? booking.uid ?? "",
          schedulingLinkSlug: eventType.slug ?? args.slug ?? "",
          attendeeName: args.attendeeName,
          attendeeEmail: args.attendeeEmail,
          startTime: args.startTime,
          endTime: args.endTime,
          eventTitle: booking.title ?? eventType.title ?? "",
        },
        { owner: hostEmail },
      );
    } catch {
      // best-effort — never block the main write
    }

    return { booking };
  },
});
