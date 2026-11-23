import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  readWorkspaceActivity,
  workspaceActivitySchema,
} from "../server/model/workspace-activity.js";

export default defineAction({
  description: "Read recent and favorite work in the current workspace.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  agentTool: false,
  persistInBrowser: false,
  readOnly: true,
  outputSchema: z.object({
    ...workspaceActivitySchema.shape,
    needsSampleWorkspace: z.boolean(),
  }),
  run: async (_input, context) => {
    const { ownerEmail, orgId } = await requireCurrentWorkspace();
    const { collections, ...activity } = await readWorkspaceActivity(
      { ownerEmail, orgId },
      currentApplicationId(context),
    );
    return {
      ...activity,
      needsSampleWorkspace:
        activity.homeRecents.projects.length === 0 && collections.length === 0,
    };
  },
});
