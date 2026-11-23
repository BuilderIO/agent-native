import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { workspaceSshKeySchema } from "../app/lib/model/workspace-ssh-key-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { getOrCreateWorkspaceSshKey } from "../server/model/workspace-ssh-key-store.js";

export default defineAction({
  description:
    "Read the current workspace's public SSH key for SSH-tunneled data connections, generating and persisting an Ed25519 key pair for the organization on first read.",
  schema: z.object({}).strict(),
  outputSchema: workspaceSshKeySchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace administrators can view the workspace SSH key.", {
        statusCode: 403,
        errorCode: "workspace_admin_required",
      });
    }
    return getOrCreateWorkspaceSshKey(current.orgId);
  },
});
