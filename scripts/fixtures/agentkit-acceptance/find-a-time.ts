import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample calendar time choice for acceptance.",
  schema: z.object({ date: z.string() }),
  http: false,
  readOnly: true,
  run: async () => ({
    change: {
      verb: "created",
      kind: "calendar-time-choice",
      title: "Best shared time",
      detail: "Thu, Apr 23 · 10:30 AM–11:15 AM · America/Los_Angeles",
      url: "/_agent-native/open?app=calendar&view=calendar",
    },
  }),
});
