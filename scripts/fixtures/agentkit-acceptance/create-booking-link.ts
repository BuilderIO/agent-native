import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample booking link for acceptance.",
  schema: z.object({ duration: z.number() }),
  http: false,
  readOnly: true,
  run: async () => ({
    change: {
      verb: "created",
      kind: "booking-link",
      title: "Booking link",
      detail: "30",
      url: "/_agent-native/open?app=calendar&view=booking-links",
    },
  }),
});
