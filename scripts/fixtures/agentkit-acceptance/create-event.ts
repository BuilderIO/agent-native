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
  chatUI: { renderer: "calendar.event-created", title: "Event created" },
  http: false,
  readOnly: true,
  run: async ({ title, start, end, startTimeZone, location }) => ({
    id: "agentkit-sample-event",
    title,
    start,
    end,
    startTimeZone,
    location,
  }),
});
