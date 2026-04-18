import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getEventTypeById,
  getEventTypeBySlug,
} from "../server/event-types-repo.js";
import { getAvailableSlots } from "../server/availability-engine.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "List available time slots for a given event type over a date range",
  schema: z.object({
    eventTypeId: z.string().optional().describe("Event type id"),
    slug: z
      .string()
      .optional()
      .describe("Event type slug (requires ownerEmail or teamId)"),
    ownerEmail: z.string().optional(),
    teamId: z.string().optional(),
    from: z.string().describe("ISO 8601 start of range"),
    to: z.string().describe("ISO 8601 end of range"),
    timezone: z.string().optional().describe("Viewer's timezone"),
  }),
  run: async (args) => {
    const event = args.eventTypeId
      ? await getEventTypeById(args.eventTypeId)
      : args.slug
        ? await getEventTypeBySlug({
            ownerEmail: args.ownerEmail,
            teamId: args.teamId,
            slug: args.slug,
          })
        : null;
    if (!event) throw new Error("Event type not found");
    const forUser = event.ownerEmail ?? currentUserEmail();
    const slots = await getAvailableSlots({
      eventType: event,
      forUserEmail: forUser,
      rangeStart: new Date(args.from),
      rangeEnd: new Date(args.to),
      viewerTimezone: args.timezone,
    });
    return { eventTypeId: event.id, slots };
  },
});
