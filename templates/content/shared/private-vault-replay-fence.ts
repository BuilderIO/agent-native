import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

export const CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT = Object.freeze({
  version: 1,
  classification: "content_free_operational_replay_fence",
  timingResolutionMs: 60_000,
  deleteWhen: "expires_at_bucket_reached",
  activePurgeMaximumHours: 25,
  backupPurgeMaximumDays: 35,
  approvedRoutingAliases: Object.freeze(["ownerEmail", "orgId"]),
  physicalFields: Object.freeze([
    "id",
    "ownerEmail",
    "orgId",
    "version",
    "vaultId",
    "endpointId",
    "nonceDigest",
    "claimedAtBucket",
    "expiresAtBucket",
  ]),
  logicalFields: Object.freeze([
    "version",
    "vaultId",
    "endpointId",
    "nonceDigest",
    "claimedAtBucket",
    "expiresAtBucket",
  ]),
});

const bucket = z.number().int().nonnegative().multipleOf(60_000);

export const privateVaultReplayFenceRecordSchema = z
  .object({
    version: z.literal(1),
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    nonceDigest: z
      .string()
      .length(64)
      .regex(/^[0-9a-f]+$/),
    claimedAtBucket: bucket,
    expiresAtBucket: bucket,
  })
  .strict()
  .superRefine((value, ctx) => {
    const retentionMs = value.expiresAtBucket - value.claimedAtBucket;
    if (retentionMs <= 0 || retentionMs > 8 * 60_000) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAtBucket"],
        message: "Replay fence expiry exceeds its bounded coarse window",
      });
    }
  });

export type PrivateVaultReplayFenceRecord = z.infer<
  typeof privateVaultReplayFenceRecordSchema
>;
