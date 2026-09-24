import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { proposeCreativeContextSuggestion } from "../store/index.js";

export default defineAction({
  description:
    "Propose an exact versioned creative-context item as the canonical logo for review.",
  schema: z.object({
    profileId: z.string().min(1).optional(),
    itemId: z.string().min(1),
    itemVersionId: z.string().min(1).optional(),
    reason: z.string().max(5000).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: (args) =>
    proposeCreativeContextSuggestion({ ...args, kind: "canonical-logo" }),
});
