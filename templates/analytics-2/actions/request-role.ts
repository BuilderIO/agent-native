import { defineAction, fail } from "@agent-native/core/action";

import {
  requestRoleOutputSchema,
  requestRoleSchema,
} from "../app/lib/model/role-request-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { fileRoleRequest } from "../server/model/role-requests-store.js";

export default defineAction({
  description:
    "Ask this workspace's administrators for an admin role. One request per person; asking again keeps the open request and updates the role asked for. Administrators and owners already hold the role.",
  schema: requestRoleSchema,
  outputSchema: requestRoleOutputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const current = await requireCurrentWorkspace();
    if (isWorkspaceAdministrator(current)) {
      fail("You already have administrator access in this workspace.", {
        statusCode: 400,
        errorCode: "role_already_held",
      });
    }
    const request = await fileRoleRequest(
      current.orgId,
      current.ownerEmail,
      input.requestedRole,
    );
    return { request };
  },
});
