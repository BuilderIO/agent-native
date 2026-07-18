import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  privateVaultObjectService,
  requirePrivateVaultActionScope,
} from "../server/lib/private-vault-objects.js";

export default defineAction({
  description:
    "Tombstone and delete all hosted ciphertext revisions for one Private Vault object.",
  schema: z
    .object({ vaultId: opaqueIdSchema, objectId: opaqueIdSchema })
    .strict(),
  http: { method: "DELETE" },
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  audit: {
    recordInputs: false,
    summary: () => "Deleted an opaque Private Vault object",
  },
  run: async (args) =>
    privateVaultObjectService.deleteObject(
      await requirePrivateVaultActionScope(args.vaultId),
      args.objectId,
    ),
});
