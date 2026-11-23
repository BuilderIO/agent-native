import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, isNull, sql } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";

import {
  resolveRoleRequestOutputSchema,
  resolveRoleRequestSchema,
} from "../app/lib/model/role-request-contracts.js";
import { getDb } from "../server/db/index.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { resolveRoleRequest } from "../server/model/role-requests-store.js";

/**
 * Decide a workspace role request. An approval raises the membership to admin
 * through the same `org_members` row every access check reads; a decline only
 * closes the request. An admin still cannot approve their own request, and an
 * owner's role is never touched.
 */
export default defineAction({
  description:
    "Approve or decline a workspace role request. Approving raises the member to admin; declining leaves their role alone. Workspace administrators only.",
  schema: resolveRoleRequestSchema,
  outputSchema: resolveRoleRequestOutputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace admins can decide role requests.", {
        statusCode: 403,
        errorCode: "role_request_admin_required",
      });
    }
    const request = await resolveRoleRequest(
      current.orgId,
      input.id,
      input.decision,
      current.ownerEmail,
    );
    if (!request) {
      fail("That role request is not open.", {
        statusCode: 404,
        errorCode: "role_request_not_open",
      });
    }
    if (
      request.requestedBy.toLowerCase() === current.ownerEmail.toLowerCase()
    ) {
      fail("You cannot decide your own role request.", {
        statusCode: 400,
        errorCode: "role_request_self_decision",
      });
    }
    if (input.decision === "approved") {
      const rows = await getDb()
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, current.orgId),
            sql`LOWER(${orgMembers.email}) = ${request.requestedBy.toLowerCase()}`,
            isNull(orgMembers.federationRemovalPendingAt),
          ),
        )
        .limit(1);
      const member = rows[0];
      if (!member) {
        fail("That person is not a member of this workspace any more.", {
          statusCode: 404,
          errorCode: "role_request_member_missing",
        });
      }
      if (member.role === "owner") {
        fail("The workspace owner's role cannot be changed.", {
          statusCode: 400,
          errorCode: "role_request_owner_immutable",
        });
      }
      await getDb()
        .update(orgMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(orgMembers.orgId, current.orgId),
            sql`LOWER(${orgMembers.email}) = ${request.requestedBy.toLowerCase()}`,
            isNull(orgMembers.federationRemovalPendingAt),
          ),
        );
    }
    return { request };
  },
});
