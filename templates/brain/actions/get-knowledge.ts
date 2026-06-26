import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { serializeKnowledge } from "../server/lib/brain.js";

export default defineAction({
  description: "Get one Brain knowledge item by ID.",
  schema: z.object({
    id: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    isConsequential: false,
  },
  run: async ({ id }) => {
    const access = await resolveAccess("brain-knowledge", id);
    if (!access) return { knowledge: null };
    return {
      knowledge: serializeKnowledge(access.resource),
      accessRole: access.role,
    };
  },
});
