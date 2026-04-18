import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { updateEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Set the location(s) on an event type",
  schema: z.object({
    id: z.string(),
    locations: z.array(z.any()),
  }),
  run: async (args) => {
    await assertAccess("event-type", args.id, "editor");
    return {
      eventType: await updateEventType(args.id, { locations: args.locations }),
    };
  },
});
