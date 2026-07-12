import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { serializeSource } from "../server/lib/brain.js";

export default defineAction({
  description: "Get one Brain source by ID.",
  schema: z.object({
    id: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const access = await resolveAccess("brain-source", id);
    if (!access) return { source: null };
    return {
      source: serializeSource(access.resource),
      accessRole: access.role,
    };
  },
});
