import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspaceCapability } from "../server/lib/analytics-capabilities.js";
import {
  readWorkspaceContextSetup,
  workspaceContextSetupSchema,
} from "../server/model/context-setup.js";
import { ANALYTICS_CONTROL_IDS as controls } from "../shared/analytics-control-ids.js";

export default defineAction({
  description: "Read setup progress for the current workspace.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  agentTool: false,
  persistInBrowser: false,
  readOnly: true,
  outputSchema: workspaceContextSetupSchema,
  run: async () => {
    const { orgId } = await requireCurrentWorkspaceCapability(
      controls.dataBrowse,
    );
    return readWorkspaceContextSetup(orgId);
  },
});
