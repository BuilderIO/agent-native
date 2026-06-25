import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { seedBrainDemoData } from "../server/lib/demo.js";

export default defineAction({
  description:
    "Seed Brain with a repeatable product-decision demo corpus covering Slack, Clips, Granola, generic imports, citations, proposals, supersedes, and privacy exclusion.",
  schema: z.object({
    publishCanonical: z.coerce
      .boolean()
      .default(true)
      .describe(
        "Mirror selected approved demo knowledge into context/company-brain workspace resources.",
      ),
  }),
  run: async ({ publishCanonical }) => seedBrainDemoData({ publishCanonical }),
});
