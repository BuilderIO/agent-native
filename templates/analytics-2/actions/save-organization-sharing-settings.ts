import { defineAction, fail } from "@agent-native/core/action";

import {
  workspaceSharingSettingsResponseSchema,
  workspaceSharingSettingsSchema,
} from "../app/lib/model/sharing-settings-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  getWorkspaceSharingCapabilities,
  writeWorkspaceSharingSettings,
} from "../server/model/sharing-settings-store.js";

export default defineAction({
  description:
    "Update the current workspace's sharing settings (share to web, share with workspace, share with guests). Administrators only.",
  schema: workspaceSharingSettingsSchema,
  outputSchema: workspaceSharingSettingsResponseSchema,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (settings) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only organization owners and admins can manage sharing settings.", {
        statusCode: 403,
        errorCode: "sharing_settings_admin_required",
      });
    }
    const capabilities = getWorkspaceSharingCapabilities();
    if (settings.allowPublicSharing && !capabilities.publicSharingSupported) {
      fail("Public web sharing is unavailable for this workspace.", {
        statusCode: 400,
        errorCode: "sharing_settings_public_unsupported",
      });
    }
    if (settings.allowGuestCreation && !capabilities.guestSharingSupported) {
      fail(
        "External guest sharing is unavailable; invite collaborators in Users settings first.",
        {
          statusCode: 400,
          errorCode: "sharing_settings_guests_unsupported",
        },
      );
    }
    const saved = await writeWorkspaceSharingSettings(current.orgId, settings);
    return {
      settings: saved,
      capabilities,
      canEdit: true,
    };
  },
});
