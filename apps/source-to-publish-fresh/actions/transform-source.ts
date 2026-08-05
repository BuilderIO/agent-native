import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  buildDraft,
  RECIPE_VALUES,
  type TransformSourceInput,
} from "../shared/transform.js";

export default defineAction({
  description:
    "Turn a local transcript, document, or article pasted into Source to Publish into a structured publishing draft.",
  schema: z.object({
    recipe: z.enum(RECIPE_VALUES).describe("Output shape for the source"),
    sourceText: z
      .string()
      .min(10)
      .describe("The transcript, document, or article text to transform"),
    sourceTitle: z.string().optional().describe("Optional source title"),
  }),
  requiresAuth: false,
  run: async (args: TransformSourceInput) => buildDraft(args),
});
