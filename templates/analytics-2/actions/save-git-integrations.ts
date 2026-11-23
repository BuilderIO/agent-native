import { defineAction, fail } from "@agent-native/core/action";

import { gitIntegrationsSettingsSchema } from "../app/lib/model/git-integrations-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { writeGitIntegrationsSettings } from "../server/model/git-integrations-store.js";

export default defineAction({
  description:
    "Save the current workspace's Git integration settings (package import, project export, and repository sync). Administrators only.",
  schema: gitIntegrationsSettingsSchema,
  outputSchema: gitIntegrationsSettingsSchema,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (settings) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current))
      fail(
        "Only organization owners and admins can manage Git integration settings.",
        {
          statusCode: 403,
          errorCode: "git_integrations_admin_required",
        },
      );
    return writeGitIntegrationsSettings(current.orgId, settings);
  },
});
