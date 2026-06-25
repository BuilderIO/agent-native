import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { syncDueBrainSourcesOnce } from "../server/jobs/sync-sources.js";

export default defineAction({
  description:
    "Run due Brain source syncs for accessible auto-sync sources. Use this to kick scheduled Slack, Granola, or GitHub polling manually.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(25).default(5),
  }),
  run: async ({ limit }) => syncDueBrainSourcesOnce({ limit }),
});
