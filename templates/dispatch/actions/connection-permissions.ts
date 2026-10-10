import type { ActionRunContext } from "@agent-native/core/action";

import { dispatchAccess } from "../server/lib/app-roles.js";

export async function assertWorkspaceConnectionManager(
  ctx: ActionRunContext | undefined,
): Promise<void> {
  await dispatchAccess.assertPermission(["administer"], {
    userEmail: ctx?.userEmail,
    orgId: ctx?.orgId,
  });
}
