import { defineAction } from "@agent-native/core";
import {
  opaqueAlgorithmIdSchema,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  decodePrivateVaultJobCiphertext,
  PRIVATE_VAULT_JOB_ACTION_MAX_BYTES,
  privateVaultJobService,
  requirePrivateVaultJobActionScope,
} from "../server/lib/private-vault-jobs.js";

export default defineAction({
  description:
    "Queue one small opaque Private Vault job envelope for a trusted endpoint.",
  schema: z
    .object({
      vaultId: opaqueIdSchema,
      jobId: opaqueIdSchema,
      grantId: opaqueIdSchema,
      recipientEndpointId: opaqueIdSchema,
      epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      algorithmId: opaqueAlgorithmIdSchema,
      issuedAt: protocolTimestampSchema,
      expiresAt: protocolTimestampSchema,
      ciphertextBase64: z.string().min(4).max(1_400_000),
      ciphertextByteLength: z
        .number()
        .int()
        .positive()
        .max(PRIVATE_VAULT_JOB_ACTION_MAX_BYTES),
    })
    .strict(),
  // The custom binary job route enforces its limit while streaming. Never
  // expose this base64-shaped internal operation through the common JSON
  // action route, which buffers a chunked body before schema validation.
  http: false,
  agentTool: false,
  toolCallable: false,
  requiresAuth: true,
  audit: {
    recordInputs: false,
    summary: () => "Queued an opaque Private Vault job",
  },
  run: async ({ ciphertextBase64, ...args }) =>
    privateVaultJobService.enqueue(
      await requirePrivateVaultJobActionScope(args.vaultId),
      {
        ...args,
        ciphertext: decodePrivateVaultJobCiphertext(ciphertextBase64),
      },
    ),
});
