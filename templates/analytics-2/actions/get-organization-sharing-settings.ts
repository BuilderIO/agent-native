import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { workspaceSharingSettingsResponseSchema } from "../app/lib/model/sharing-settings-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  getWorkspaceSharingCapabilities,
  readWorkspaceSharingSettings,
} from "../server/model/sharing-settings-store.js";

export default defineAction({
  description:
    "Read the current workspace's sharing settings (share to web, share with workspace, share with guests) and platform capabilities.",
  schema: z.object({}).strict(),
  outputSchema: workspaceSharingSettingsResponseSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    const capabilities = getWorkspaceSharingCapabilities();
    const settings = await readWorkspaceSharingSettings(current.orgId);
    return {
      settings,
      capabilities,
      canEdit: isWorkspaceAdministrator(current),
    };
  },
});
