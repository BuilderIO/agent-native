import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import {
  readWorkspaceNavigation,
  workspaceNavigationSchema,
} from "../server/model/workspace-navigation.js";

export default defineAction({
  description: "Read workspace switcher entries and Library availability.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  agentTool: false,
  persistInBrowser: false,
  readOnly: true,
  outputSchema: workspaceNavigationSchema,
  run: async () => {
    const { ownerEmail, orgId } = await requireCurrentWorkspace();
    return readWorkspaceNavigation({ ownerEmail, orgId });
  },
});
