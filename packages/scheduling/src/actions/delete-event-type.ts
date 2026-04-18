import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deleteEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Delete an event type",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    await deleteEventType(args.id);
    return { ok: true };
  },
});
