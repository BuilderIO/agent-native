import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { deleteEventType } from "../server/event-types-repo.js";

export default defineAction({
  description: "Delete an event type",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    await assertAccess("event-type", args.id, "admin");
    await deleteEventType(args.id);
    return { ok: true };
  },
});
