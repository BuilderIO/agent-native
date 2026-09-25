import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireOrgMember } from "../actions.js";
import {
  getAppPermissionOverrides,
  getRegisteredAppRoles,
} from "../app-roles.js";

export default defineAction({
  description:
    "List code-declared app permissions and their effective organization role grants.",
  http: { method: "GET" },
  schema: z.object({ appId: z.string().trim().min(1).max(200) }),
  run: async ({ appId }, ctx) => {
    const caller = await requireOrgMember(ctx);
    const descriptor = getRegisteredAppRoles(appId);
    if (!descriptor) throw new Error(`No app roles registered for ${appId}.`);
    const overrides = await getAppPermissionOverrides(appId, caller.orgId);
    return {
      appId,
      permissions: Object.fromEntries(
        Object.entries(descriptor.permissions ?? {}).map(
          ([permission, defaults]) => [
            permission,
            {
              defaults,
              roles: overrides[permission] ?? defaults,
              overridden: overrides[permission] !== undefined,
            },
          ],
        ),
      ),
    };
  },
});
