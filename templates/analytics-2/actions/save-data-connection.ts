import { defineAction } from "@agent-native/core/action";

import { requireCurrentWorkspaceCapability } from "../server/lib/analytics-capabilities.js";
import {
  connectionContext,
  dataConnectionOutput,
  saveConnectionSchema,
  saveDataConnection,
} from "../server/model/data-connections.js";
import { ANALYTICS_CONTROL_IDS as controls } from "../shared/analytics-control-ids.js";
export default defineAction({
  description:
    "Validate and save a warehouse connection from the private credential form. Credential input is never audited or returned.",
  schema: saveConnectionSchema,
  outputSchema: dataConnectionOutput,
  http: { method: "POST" },
  uiOnly: true,
  maxBodyBytes: 128 * 1024,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  audit: { recordInputs: false },
  run: async (input) => {
    if (input.id === undefined && connectionContext().orgId) {
      await requireCurrentWorkspaceCapability(
        controls.bigQueryConnectionCreate,
      );
    }
    return saveDataConnection(input);
  },
});
