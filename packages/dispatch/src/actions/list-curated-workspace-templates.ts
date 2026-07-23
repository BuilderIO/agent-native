import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listCuratedWorkspaceTemplates } from "../server/lib/curated-workspace-templates.js";

export default defineAction({
  description:
    "List the curated first-party workspace templates available for private remixing. Returns stable template metadata, the product/live URL (not a public-demo claim), setup guidance, and whether each source template is already installed in the current workspace.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listCuratedWorkspaceTemplates(),
});
