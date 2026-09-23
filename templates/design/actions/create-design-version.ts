import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createDesignVersionSnapshot } from "../server/lib/design-versions.js";

export default defineAction({
  description:
    "Create one frontend editor history checkpoint before a grouped design mutation.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({
    designId: z.string().describe("Design project ID"),
  }),
  run: async ({ designId }) => {
    const version = await createDesignVersionSnapshot(designId, {
      label: "Before editor screen delete",
      chatContext: { surface: "editor", actionName: "delete-file" },
    });
    return version;
  },
});
