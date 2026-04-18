import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { updateEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Set the location(s) on an event type",
  schema: z.object({
    id: z.string(),
    locations: z.array(z.any()),
  }),
  run: async (args) => {
    return {
      eventType: await updateEventType(args.id, { locations: args.locations }),
    };
  },
});
