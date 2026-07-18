import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  privateVaultJobService,
  requirePrivateVaultJobActionScope,
} from "../server/lib/private-vault-jobs.js";

export default defineAction({
  description:
    "List content-free routing metadata for the current owner's Private Vault jobs.",
  schema: z.object({ vaultId: opaqueIdSchema }).strict(),
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  audit: {
    recordInputs: false,
    summary: () => "Listed opaque Private Vault jobs",
  },
  run: async ({ vaultId }) =>
    privateVaultJobService.list(
      await requirePrivateVaultJobActionScope(vaultId),
    ),
});
