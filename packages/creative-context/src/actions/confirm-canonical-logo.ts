import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { decideCanonicalLogoSuggestion } from "../store/index.js";

export default defineAction({
  description: "Confirm or reject a proposed canonical logo after review.",
  schema: z.object({
    suggestionId: z.string().min(1),
    decision: z.enum(["confirm", "reject"]),
  }),
  needsApproval: true,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: decideCanonicalLogoSuggestion,
});
