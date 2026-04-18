import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { updateEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Reorder event types by passing the desired id order",
  schema: z.object({ ids: z.array(z.string()) }),
  run: async (args) => {
    for (let i = 0; i < args.ids.length; i++) {
      await updateEventType(args.ids[i], { position: i });
    }
    return { ok: true };
  },
});
