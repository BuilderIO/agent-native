import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  updateEventType,
  getEventTypeById,
} from "../server/event-types-repo.js";

export default defineAction({
  description: "Toggle hidden (unpublished) state on an event type",
  schema: z.object({ id: z.string(), hidden: z.boolean().optional() }),
  run: async (args) => {
    const current = await getEventTypeById(args.id);
    if (!current) throw new Error("Event type not found");
    const target = args.hidden ?? !current.hidden;
    return {
      eventType: await updateEventType(args.id, { hidden: target }),
    };
  },
});
