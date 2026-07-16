import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  privateVaultObjectService,
  requirePrivateVaultActionScope,
} from "../server/lib/private-vault-objects.js";

export default defineAction({
  description:
    "Get content-free metadata for one encrypted Private Vault object revision.",
  schema: z
    .object({
      vaultId: opaqueIdSchema,
      objectId: opaqueIdSchema,
      revisionId: opaqueIdSchema,
    })
    .strict(),
  http: { method: "GET" },
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  readOnly: true,
  audit: {
    onRead: true,
    recordInputs: false,
    summary: () => "Read opaque Private Vault revision metadata",
  },
  run: async (args) =>
    privateVaultObjectService.getMetadata(
      requirePrivateVaultActionScope(args.vaultId),
      args.objectId,
      args.revisionId,
    ),
});
