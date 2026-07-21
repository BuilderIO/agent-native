import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { publishBrandDna } from "../store/index.js";

export default defineAction({
  description:
    "Publish an immutable brand DNA version pinned to exact evidence item versions and refresh transparent brand context.",
  schema: z.object({
    profileId: z.string().min(1),
    proposalVersionId: z.string().min(1),
    confirmation: z.object({
      proposalVersionId: z.string().min(1),
      contentHash: z.string().length(64),
    }),
  }),
  needsApproval: true,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: publishBrandDna,
});
