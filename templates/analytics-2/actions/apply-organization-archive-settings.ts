import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { readArchiveSettings } from "../server/model/archive-settings-store.js";
import { archiveStaleProjects } from "../server/model/archive-stale-projects.js";

export default defineAction({
  description:
    "Archive the workspace's projects that exceed its auto-archive criteria now. Does nothing while both rules are off. Administrators only.",
  schema: z.object({}).strict(),
  outputSchema: z.object({ archived: z.number().int().min(0) }),
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async () => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current))
      fail("Only organization owners and admins can apply archive settings.", {
        statusCode: 403,
        errorCode: "archive_settings_admin_required",
      });
    const settings = await readArchiveSettings(current.orgId);
    return { archived: await archiveStaleProjects(current.orgId, settings) };
  },
});
