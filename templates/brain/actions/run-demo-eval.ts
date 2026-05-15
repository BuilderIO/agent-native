import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runBrainDemoEval } from "../server/lib/demo.js";

export default defineAction({
  description:
    "Run Brain's repeatable demo eval for search quality, citations, supersede narration data, proposal gating, redaction, personal-content exclusion, and honest not-found behavior.",
  schema: z.object({
    seedIfMissing: z.coerce
      .boolean()
      .default(true)
      .describe("Seed the demo corpus before evaluating."),
    publishCanonical: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When seeding during the eval, also publish selected canonical facts to workspace resources.",
      ),
  }),
  run: async ({ seedIfMissing, publishCanonical }) =>
    runBrainDemoEval({ seedIfMissing, publishCanonical }),
});
