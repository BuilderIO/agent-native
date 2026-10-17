import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample calendar event for widget acceptance.",
  schema: z.object({
    title: z.string(),
    start: z.string(),
    end: z.string(),
    startTimeZone: z.string(),
    location: z.string(),
  }),
  http: false,
  readOnly: true,
  run: async ({ title, start, end, startTimeZone, location }) => ({
    id: "agentkit-sample-event",
    title,
    start,
    end,
    startTimeZone,
    location,
    change: {
      verb: "created",
      kind: "calendar-event",
      title,
      detail: `Oct 1, 2026 · 9:00–10:00 AM PT · ${location}`,
      url: "/calendar?eventId=agentkit-sample-event",
    },
  }),
});
