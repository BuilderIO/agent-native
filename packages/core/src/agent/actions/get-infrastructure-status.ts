import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  getInfrastructureStatus,
  type InfrastructureStatus,
} from "../../server/infrastructure-status.js";
import { readOrgMemberRole } from "../../server/personal-provider-key-policy.js";

export const INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE =
  "infrastructure_admin_required";

export default defineAction({
  description:
    "Read the workspace's environment for Settings › Infrastructure: the database (provider, host, and the variable it comes from; never the URL), where the apps are hosted and each app's address, which deploy variables are set (DATABASE_URL, A2A_SECRET, BETTER_AUTH_SECRET, APP_URL, SECRETS_ENCRYPTION_KEY; values are never returned), and which services the app profile marks required or recommended. Owners and admins only. These are set on the host, not in Settings: to change one, set it in the host's environment and redeploy. For storage use get-file-storage, for services manage-service-providers, and for AI providers list-model-providers.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  // The database host and deploy layout are not for sandboxed extensions.
  toolCallable: false,
  run: async (_args, ctx): Promise<InfrastructureStatus> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) {
      fail("Sign in to view infrastructure.", { statusCode: 401 });
    }
    const orgId = ctx?.orgId?.trim();
    // A workspace without an organization has one user and no role gradient,
    // like file storage and the secrets routes.
    if (orgId) {
      const role = await readOrgMemberRole(orgId, email);
      if (!role) {
        fail("You aren't a member of this organization.", {
          statusCode: 403,
        });
      }
      if (!canManageOrg(role)) {
        fail("Only organization owners and admins can view infrastructure.", {
          statusCode: 403,
          errorCode: INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE,
        });
      }
    }
    return getInfrastructureStatus({ appId: ctx?.appId });
  },
});
