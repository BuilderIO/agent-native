import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  privateVaultJobService,
  requirePrivateVaultJobActionScope,
} from "../server/lib/private-vault-jobs.js";

export default defineAction({
  description:
    "Cancel one nonterminal opaque Private Vault job owned by the current account.",
  schema: z.object({ vaultId: opaqueIdSchema, jobId: opaqueIdSchema }).strict(),
  http: { method: "POST" },
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  audit: {
    recordInputs: false,
    summary: () => "Cancelled an opaque Private Vault job",
  },
  run: async ({ vaultId, jobId }) =>
    privateVaultJobService.cancel(
      requirePrivateVaultJobActionScope(vaultId),
      jobId,
    ),
});
