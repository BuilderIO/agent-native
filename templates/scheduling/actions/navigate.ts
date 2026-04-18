import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

const views = [
  "event-types",
  "event-type",
  "availability",
  "schedule",
  "bookings",
  "booking",
  "teams",
  "team",
  "apps",
  "workflows",
  "routing-forms",
  "settings",
  "insights",
] as const;

export default defineAction({
  description:
    "Navigate the UI to a view. Agent writes this, UI consumes and deletes.",
  schema: z.object({
    view: z.enum(views),
    eventTypeId: z.string().optional(),
    eventTypeTab: z
      .enum([
        "setup",
        "availability",
        "limits",
        "advanced",
        "apps",
        "workflows",
      ])
      .optional(),
    scheduleId: z.string().optional(),
    bookingStatus: z
      .enum(["upcoming", "past", "unconfirmed", "cancelled", "recurring"])
      .optional(),
    bookingUid: z.string().optional(),
    routingFormId: z.string().optional(),
    teamId: z.string().optional(),
    workflowId: z.string().optional(),
    settingsSection: z.string().optional(),
    date: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", { ...args, ts: Date.now() });
    return { ok: true };
  },
});
