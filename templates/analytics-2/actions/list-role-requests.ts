import { defineAction } from "@agent-native/core/action";

import {
  listRoleRequestsSchema,
  roleRequestsSchema,
} from "../app/lib/model/role-request-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { listRoleRequests } from "../server/model/role-requests-store.js";

/**
 * Read role requests. An administrator reads the whole queue to decide it; a
 * member reads only their own row, which is what their profile shows beside the
 * request button. Nobody sees another member's request unless they administer
 * the workspace.
 */
export default defineAction({
  description:
    "Read workspace role requests: administrators see every request, a member sees only their own.",
  schema: listRoleRequestsSchema,
  outputSchema: roleRequestsSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const current = await requireCurrentWorkspace();
    const requests = await listRoleRequests(current.orgId);
    if (isWorkspaceAdministrator(current)) return { requests };
    const wanted = current.ownerEmail.toLowerCase();
    return {
      requests: requests.filter(
        (request) => request.requestedBy.toLowerCase() === wanted,
      ),
    };
  },
});
