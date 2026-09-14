import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { restoreDesignVersion } from "../server/lib/design-versions.js";

export default defineAction({
  description:
    "Restore a Design to a saved history checkpoint. The current live design " +
    "is saved first, and restore fails if another collaborator is active.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    versionId: z.string().describe("Design history checkpoint ID"),
  }),
  run: async ({ designId, versionId }, context) =>
    restoreDesignVersion({ designId, versionId, context }),
});
