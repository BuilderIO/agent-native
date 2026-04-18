import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getEventTypeById } from "../server/event-types-repo.js";
import { getAvailableSlots } from "../server/availability-engine.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "Find the next available time slot for an event type, optionally near a preferred time",
  schema: z.object({
    eventTypeId: z.string(),
    preferredTime: z.string().optional().describe("ISO 8601 preferred time"),
    timezone: z.string().optional(),
  }),
  run: async (args) => {
    const event = await getEventTypeById(args.eventTypeId);
    if (!event) throw new Error("Event type not found");
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const slots = await getAvailableSlots({
      eventType: event,
      forUserEmail: event.ownerEmail ?? currentUserEmail(),
      rangeStart: now,
      rangeEnd: end,
      viewerTimezone: args.timezone,
    });
    if (slots.length === 0) return { slot: null };
    if (args.preferredTime) {
      const target = new Date(args.preferredTime).getTime();
      const nearest = slots.reduce((best, s) =>
        Math.abs(new Date(s.start).getTime() - target) <
        Math.abs(new Date(best.start).getTime() - target)
          ? s
          : best,
      );
      return { slot: nearest };
    }
    return { slot: slots[0] };
  },
});
