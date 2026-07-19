import { defineAction } from "@agent-native/core";
import { E2EE_SUITE_ID, opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  decodePrivateVaultCiphertext,
  privateVaultObjectService,
  requirePrivateVaultActionScope,
} from "../server/lib/private-vault-objects.js";

export default defineAction({
  description:
    "Internal operation behind the bounded binary relay for one encrypted Private Vault object revision.",
  schema: z
    .object({
      vaultId: opaqueIdSchema,
      objectId: opaqueIdSchema,
      revisionId: opaqueIdSchema,
      revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      objectType: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[a-z][a-z0-9._:-]*$/),
      algorithmId: z.literal(E2EE_SUITE_ID),
      epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      parentRevisionIds: z.array(opaqueIdSchema).max(32).optional(),
      ciphertextBase64: z.string().min(4).max(1_400_000),
      ciphertextByteLength: z
        .number()
        .int()
        .positive()
        .max(1024 * 1024),
    })
    .strict(),
  // Ciphertext uploads are available only through the custom binary route,
  // whose stream is bounded before buffering. Mounting this schema as a JSON
  // action route would create an alternate chunked-body memory-DoS path.
  http: false,
  requiresAuth: true,
  // Ciphertext bodies are transport payloads, not model context. Agents use
  // the brokered protected document actions; clients use the bounded binary
  // relay without placing base64 in hosted tool events or ledgers.
  agentTool: false,
  toolCallable: false,
  audit: {
    recordInputs: false,
    summary: () => "Relayed an opaque Private Vault object revision",
  },
  run: async (args) => {
    const ciphertext = decodePrivateVaultCiphertext(args.ciphertextBase64);
    return privateVaultObjectService.putRevision(
      await requirePrivateVaultActionScope(args.vaultId),
      {
        vaultId: args.vaultId,
        objectId: args.objectId,
        revisionId: args.revisionId,
        revision: args.revision,
        objectType: args.objectType,
        algorithmId: args.algorithmId,
        epoch: args.epoch,
        parentRevisionIds: args.parentRevisionIds ?? [],
        ciphertextByteLength: args.ciphertextByteLength,
        ciphertext,
      },
    );
  },
});
