import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { openQueuedDraftInComposer } from "../server/lib/queued-drafts.js";

export default defineAction({
  description:
    "Open a queued email draft in the compose window so the owner can manually tweak and send it.",
  schema: z.object({
    id: z.string().describe("Queued draft ID"),
  }),
  run: async (args) => {
    return openQueuedDraftInComposer(args.id);
  },
});
