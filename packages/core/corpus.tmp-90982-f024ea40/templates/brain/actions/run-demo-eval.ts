import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeBrainEvalSnapshot } from "../server/lib/brain-health.js";
import { runBrainDemoEval, runBrainRetrievalEval } from "../server/lib/demo.js";

export default defineAction({
  description:
    "Run Brain's repeatable demo evals for product-decision trust checks or real-channel-style retrieval quality.",
  schema: z.object({
    mode: z
      .enum(["product-demo", "retrieval"])
      .default("product-demo")
      .describe(
        "Eval mode: product-demo checks the seeded product-decision corpus; retrieval checks real-channel-style Brain retrieval.",
      ),
    seedIfMissing: z.coerce
      .boolean()
      .default(true)
      .describe(
        "Seed fallback demo data when the selected eval has no existing workspace support.",
      ),
    publishCanonical: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When seeding during the eval, also publish selected canonical facts to workspace resources.",
      ),
  }),
  run: async ({ mode, seedIfMissing, publishCanonical }) => {
    const result =
      mode === "retrieval"
        ? await runBrainRetrievalEval({ seedIfMissing, publishCanonical })
        : await runBrainDemoEval({ seedIfMissing, publishCanonical });
    await writeBrainEvalSnapshot(result);
    return result;
  },
});
