import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  appointmentPlanSchema,
  parseAppointmentSource,
} from "../app/lib/appointment-plan";

export default defineAction({
  description:
    "Parse appointment invitations into one-off work-calendar block windows with a buffer before and after. Use this after reading a personal inbox or receiving pasted invitation text. This action only prepares a reviewable plan; it does not write to a calendar.",
  schema: z.object({
    sourceText: z.string().min(1).describe("Appointment invitation lines"),
    bufferMinutes: z
      .number()
      .int()
      .min(0)
      .max(240)
      .default(30)
      .describe("Minutes to add before and after each appointment"),
    sourceLabel: z
      .string()
      .min(1)
      .max(120)
      .default("Personal inbox")
      .describe("Human-readable source label"),
  }),
  outputSchema: appointmentPlanSchema,
  run: async ({ sourceText, bufferMinutes, sourceLabel }) => {
    const appointments = parseAppointmentSource(sourceText, bufferMinutes);
    const plan = appointmentPlanSchema.parse({
      planId: `plan-${Date.now()}`,
      sourceLabel,
      bufferMinutes,
      timezone: "America/Los_Angeles",
      appointments,
      conflictCheck: {
        status: "not_checked",
        checkedAt: "",
        conflicts: [],
      },
      status: "draft",
      approvedAt: null,
    });
    await writeAppState("appointment-plan", plan);
    return plan;
  },
});
