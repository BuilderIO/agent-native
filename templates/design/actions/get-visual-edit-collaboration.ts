import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Get whether shared live HTML previews are enabled for a Design. Requires viewer access.",
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
  }),
  readOnly: true,
  requiresAuth: false,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await assertAccess("design", designId, "viewer");
    const design = access.resource as typeof schema.designs.$inferSelect;
    return {
      designId,
      enabled: design.liveCollaborationEnabled === true,
    };
  },
});
