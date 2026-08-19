import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCreativeContext } from "../server/context.js";
import { listCreativeContextSuggestions } from "../store/index.js";

export default defineAction({
  description:
    "List creative-context logo and layout proposals awaiting explicit human review.",
  schema: z.object({
    kind: z.enum(["canonical-logo", "layout-template"]).optional(),
    status: z
      .enum(["proposed", "confirmed", "rejected", "promoted", "demoted"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    const projections = getCreativeContext().projections;
    return {
      suggestions: await listCreativeContextSuggestions(args),
      capabilities: {
        canonicalLogo: Boolean(projections?.canonicalLogo),
        layoutTemplate: Boolean(projections?.layoutTemplate),
      },
    };
  },
});
