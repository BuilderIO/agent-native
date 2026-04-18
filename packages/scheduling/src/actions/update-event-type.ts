import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { updateEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Update one or more fields on an event type",
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().nullable().optional(),
    length: z.coerce.number().optional(),
    durations: z.array(z.number()).optional(),
    hidden: z.boolean().optional(),
    position: z.number().optional(),
    schedulingType: z
      .enum(["personal", "collective", "round-robin", "managed"])
      .optional(),
    scheduleId: z.string().nullable().optional(),
    locations: z.array(z.any()).optional(),
    customFields: z.array(z.any()).optional(),
    minimumBookingNotice: z.number().optional(),
    beforeEventBuffer: z.number().optional(),
    afterEventBuffer: z.number().optional(),
    slotInterval: z.number().nullable().optional(),
    periodType: z.enum(["unlimited", "rolling", "range"]).optional(),
    periodDays: z.number().nullable().optional(),
    periodStartDate: z.string().nullable().optional(),
    periodEndDate: z.string().nullable().optional(),
    seatsPerTimeSlot: z.number().nullable().optional(),
    requiresConfirmation: z.boolean().optional(),
    disableGuests: z.boolean().optional(),
    hideCalendarNotes: z.boolean().optional(),
    successRedirectUrl: z.string().nullable().optional(),
    bookingLimits: z.any().optional(),
    lockTimeZoneToggle: z.boolean().optional(),
    color: z.string().nullable().optional(),
    eventName: z.string().nullable().optional(),
  }),
  run: async (args) => {
    const { id, ...patch } = args;
    await assertAccess("event-type", id, "editor");
    return { eventType: await updateEventType(id, patch as any) };
  },
});
