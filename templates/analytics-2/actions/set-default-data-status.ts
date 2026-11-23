import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { setDefaultStatus } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Set or clear the default status for new projects in the current workspace. Administrators only.",
  schema: z.object({ id: z.string().min(1).nullable() }).strict(),
  outputSchema: z.object({ id: z.string().nullable() }),
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current))
      fail("Only organisation owners and admins can manage statuses.", {
        statusCode: 403,
        errorCode: "data_status_admin_required",
      });
    await setDefaultStatus(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      id,
    );
    return { id };
  },
});
