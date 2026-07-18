import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  privateVaultObjectService,
  requirePrivateVaultActionScope,
} from "../server/lib/private-vault-objects.js";

export default defineAction({
  description:
    "List content-free revision metadata for an encrypted Private Vault object.",
  schema: z
    .object({ vaultId: opaqueIdSchema, objectId: opaqueIdSchema })
    .strict(),
  http: { method: "GET" },
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  readOnly: true,
  audit: {
    onRead: true,
    recordInputs: false,
    summary: () => "Listed opaque Private Vault revisions",
  },
  run: async (args) =>
    privateVaultObjectService.listRevisions(
      await requirePrivateVaultActionScope(args.vaultId),
      args.objectId,
    ),
});
