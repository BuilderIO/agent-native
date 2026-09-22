import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  previewBrandProfilePromotion,
  promoteBrandProfileToOrg,
} from "../store/index.js";

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("preview-promotion"),
    profileId: z.string().min(1),
  }),
  z.object({
    operation: z.literal("promote-to-org"),
    profileId: z.string().min(1),
    confirmation: z.object({
      profileName: z.string().min(1),
      dnaVersionId: z.string().min(1),
      targetOrgId: z.string().min(1),
    }),
  }),
]);

const agentInputSchema = z.object({
  operation: z.enum(["preview-promotion", "promote-to-org"]),
  profileId: z.string().min(1),
  confirmation: z
    .object({
      profileName: z.string().min(1),
      dnaVersionId: z.string().min(1),
      targetOrgId: z.string().min(1),
    })
    .optional(),
});

export default defineAction({
  description:
    "Preview or explicitly promote a human-published brand profile to the active organization; inferred proposals are never promoted automatically.",
  schema,
  agentInputSchema,
  needsApproval: (args) => args.operation === "promote-to-org",
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: async (args) =>
    args.operation === "preview-promotion"
      ? { promotionPreview: await previewBrandProfilePromotion(args.profileId) }
      : {
          promoted: await promoteBrandProfileToOrg(
            args.profileId,
            args.confirmation,
          ),
        },
});
