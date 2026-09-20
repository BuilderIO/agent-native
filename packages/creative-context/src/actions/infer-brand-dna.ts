import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { inferBrandDnaProposalFromCorpus } from "../store/index.js";

export default defineAction({
  description:
    "Infer a deterministic draft Design DNA proposal from hydrated corpus colors, fonts, layouts, and voice evidence. The proposal never changes published context.",
  schema: z.object({
    sourceId: z.string().min(1),
    profileId: z.string().min(1).optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: inferBrandDnaProposalFromCorpus,
});
