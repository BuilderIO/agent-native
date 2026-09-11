import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDesignVersions } from "../server/lib/design-versions.js";

export default defineAction({
  description:
    "List the saved Design history checkpoints that can be restored. Returns " +
    "metadata only, not the stored file contents.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of history checkpoints to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ designId, limit }) => listDesignVersions(designId, limit),
});
