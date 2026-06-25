import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeBrainEvalSnapshot } from "../server/lib/brain-health.js";
import { runBrainRetrievalEval } from "../server/lib/demo.js";

export default defineAction({
  description:
    "Run Brain's offline real-channel-style retrieval eval, using existing workspace data when it supports the cases and seeding #dev-fusion fallback data when absent.",
  schema: z.object({
    seedIfMissing: z.coerce
      .boolean()
      .default(true)
      .describe(
        "Seed the #dev-fusion fallback corpus when existing workspace data does not satisfy the answer cases.",
      ),
    publishCanonical: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When seeding fallback data, also publish selected canonical facts to workspace resources.",
      ),
  }),
  run: async ({ seedIfMissing, publishCanonical }) => {
    const result = await runBrainRetrievalEval({
      seedIfMissing,
      publishCanonical,
    });
    await writeBrainEvalSnapshot(result);
    return result;
  },
});
