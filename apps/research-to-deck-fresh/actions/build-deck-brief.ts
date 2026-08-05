import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { buildDeckBrief } from "../app/lib/deck-brief.js";

export default defineAction({
  description:
    "Turn research notes into a concise, reviewable QBR or meeting deck brief using a deterministic local outline.",
  schema: z.object({
    sourceText: z
      .string()
      .min(1)
      .max(20_000)
      .describe("Research notes to shape into a concise deck brief"),
  }),
  run: async ({ sourceText }) => buildDeckBrief(sourceText),
});
