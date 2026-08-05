import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import {
  appointmentPlanSchema,
  conflictCheckSchema,
  overlaps,
  parseCalendarSnapshot,
} from "../app/lib/appointment-plan";

export default defineAction({
  description:
    "Compare the prepared appointment block windows against a work-calendar snapshot and identify overlapping events with external attendees. A connected-calendar agent can pass summarized events as lines like 'Customer call | Wed Oct 7, 2026 9am - 9:30am | attendees: person@example.com'. Do not report clear until a real calendar snapshot was checked.",
  schema: z.object({
    calendarText: z
      .string()
      .min(1)
      .describe("Bounded work-calendar events in the documented line format"),
  }),
  outputSchema: appointmentPlanSchema,
  run: async ({ calendarText }) => {
    const stored = await readAppState("appointment-plan");
    if (!stored)
      throw new Error("Prepare appointment blocks before checking conflicts.");
    const plan = appointmentPlanSchema.parse(stored);
    const events = parseCalendarSnapshot(calendarText);
    if (events.length === 0) {
      throw new Error(
        "No calendar events found. Include at least one dated event line or report that the connected calendar returned no events.",
      );
    }

    const conflicts = events.flatMap((event) => {
      const appointmentIds = plan.appointments
        .filter((appointment) =>
          overlaps(
            appointment.blockStart,
            appointment.blockEnd,
            event.startTime,
            event.endTime,
          ),
        )
        .map((appointment) => appointment.id);
      if (appointmentIds.length === 0) return [];
      return [
        {
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          attendees: event.attendees,
          externalAttendees: event.attendees.filter(
            (email) => !email.toLowerCase().endsWith("@builder.io"),
          ),
          appointmentIds,
        },
      ];
    });

    const status = conflicts.some(
      (conflict) => conflict.externalAttendees.length,
    )
      ? "external_conflicts"
      : conflicts.length
        ? "internal_only"
        : "clear";
    const conflictCheck = conflictCheckSchema.parse({
      status,
      checkedAt: new Date().toISOString(),
      conflicts,
    });
    const updated = appointmentPlanSchema.parse({
      ...plan,
      conflictCheck,
      status: "review",
    });
    await writeAppState("appointment-plan", updated);
    return updated;
  },
});
