import { defineAction, fail } from "@agent-native/core/action";

import { archiveSettingsSchema } from "../app/lib/model/archive-settings-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { writeArchiveSettings } from "../server/model/archive-settings-store.js";

export default defineAction({
  description:
    "Set the current workspace's auto-archive criteria (days without an edit, days without a view; null turns a rule off). Administrators only.",
  schema: archiveSettingsSchema,
  outputSchema: archiveSettingsSchema,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (settings) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current))
      fail("Only organization owners and admins can manage archive settings.", {
        statusCode: 403,
        errorCode: "archive_settings_admin_required",
      });
    return writeArchiveSettings(current.orgId, settings);
  },
});
