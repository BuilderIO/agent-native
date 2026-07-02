import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { readBrainHealth } from "../server/lib/brain-health.js";

export { readBrainHealth };

export default defineAction({
  description:
    "Summarize Brain setup and source health, including configured sources, sync freshness, pending proposals, queue issues, last eval score, and suggested next setup steps.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => readBrainHealth(),
});
