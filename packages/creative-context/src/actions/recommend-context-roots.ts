import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { recommendContextRoots } from "../connectors/recommendations.js";
import { getCreativeContext } from "../server/context.js";

export default defineAction({
  description:
    "Return read-only provider-backed source recommendations for confirmation. Recommendations are never an import boundary and are not persisted.",
  schema: z.object({
    provider: z.enum(["notion", "google-slides", "figma"]),
    connectionId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(15),
    figmaProjectId: z.string().min(1).optional(),
    figmaTeamId: z.string().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const { connectorContext } = getCreativeContext();
    return recommendContextRoots(args, connectorContext);
  },
});
