import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sourceDocumentIdSchema = z.string().min(1).max(256);

export const privateVaultMigrationStateSchema = z.enum([
  "preflight",
  "copying",
  "verifying",
  "ready_for_cutover",
  "cutover",
  "cleanup_eligible",
  "cleaned",
  "rolled_back",
  "failed",
]);

export const privateVaultMigrationItemStateSchema = z.enum([
  "pending",
  "sealed",
  "verified",
  "cleaned",
]);

export const privateVaultMigrationLedgerSchema = z
  .object({
    migrationId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    state: privateVaultMigrationStateSchema,
    sourceSnapshotHash: digestSchema,
    sourceCount: z.number().int().nonnegative().max(10_000),
    verifiedCount: z.number().int().nonnegative().max(10_000),
    exportBundleHash: digestSchema.nullable(),
    exportVerifiedAt: timestampSchema.nullable(),
    recoveryDrillVerifiedAt: timestampSchema.nullable(),
    backupRetentionAcknowledgedAt: timestampSchema.nullable(),
    cutoverAt: timestampSchema.nullable(),
    cleanupAt: timestampSchema.nullable(),
    rolledBackAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verifiedCount > value.sourceCount)
      context.addIssue({
        code: "custom",
        path: ["verifiedCount"],
        message: "Verified count cannot exceed the frozen source count",
      });
  });

export type PrivateVaultMigrationLedger = z.infer<
  typeof privateVaultMigrationLedgerSchema
>;

export const privateVaultMigrationItemSchema = z
  .object({
    migrationId: opaqueIdSchema,
    sourceDocumentId: sourceDocumentIdSchema,
    parentSourceDocumentId: sourceDocumentIdSchema.nullable(),
    objectId: opaqueIdSchema,
    sourceDigest: digestSchema,
    state: privateVaultMigrationItemStateSchema,
    sealedRevisionId: opaqueIdSchema.nullable(),
    sealedCiphertextHash: digestSchema.nullable(),
    verifiedAt: timestampSchema.nullable(),
    cleanupAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.state === "sealed" ||
        value.state === "verified" ||
        value.state === "cleaned") &&
      (!value.sealedRevisionId || !value.sealedCiphertextHash)
    )
      context.addIssue({
        code: "custom",
        path: ["sealedRevisionId"],
        message: "A sealed migration item requires its exact ciphertext proof",
      });
    if (
      (value.state === "verified" || value.state === "cleaned") &&
      !value.verifiedAt
    )
      context.addIssue({
        code: "custom",
        path: ["verifiedAt"],
        message: "A verified migration item requires a verification time",
      });
    if (value.state === "cleaned" && !value.cleanupAt)
      context.addIssue({
        code: "custom",
        path: ["cleanupAt"],
        message: "A cleaned migration item requires a cleanup time",
      });
  });

export type PrivateVaultMigrationItem = z.infer<
  typeof privateVaultMigrationItemSchema
>;

const allowedTransitions: Readonly<
  Record<
    PrivateVaultMigrationLedger["state"],
    readonly PrivateVaultMigrationLedger["state"][]
  >
> = Object.freeze({
  preflight: ["copying", "rolled_back", "failed"],
  copying: ["verifying", "rolled_back", "failed"],
  verifying: ["copying", "ready_for_cutover", "rolled_back", "failed"],
  ready_for_cutover: ["cutover", "rolled_back", "failed"],
  cutover: ["cleanup_eligible", "rolled_back", "failed"],
  cleanup_eligible: ["cleaned", "rolled_back", "failed"],
  cleaned: [],
  rolled_back: [],
  failed: ["copying", "verifying", "rolled_back"],
});

/**
 * Validate one durable migration state transition. The feature flag decides
 * whether a ceremony may begin; it never rewrites this ledger or changes an
 * encrypted vault back into Standard Cloud mode.
 */
export function assertPrivateVaultMigrationTransition(
  previousInput: PrivateVaultMigrationLedger,
  nextInput: PrivateVaultMigrationLedger,
): PrivateVaultMigrationLedger {
  const previous = privateVaultMigrationLedgerSchema.parse(previousInput);
  const next = privateVaultMigrationLedgerSchema.parse(nextInput);
  if (
    previous.migrationId !== next.migrationId ||
    previous.vaultId !== next.vaultId ||
    previous.sourceSnapshotHash !== next.sourceSnapshotHash ||
    previous.sourceCount !== next.sourceCount
  )
    throw new Error("Private Vault migration identity is immutable");
  if (
    previous.state !== next.state &&
    !allowedTransitions[previous.state].includes(next.state)
  )
    throw new Error("Private Vault migration transition is not allowed");
  if (next.verifiedCount < previous.verifiedCount)
    throw new Error(
      "Private Vault migration verification cannot move backward",
    );
  if (
    (next.state === "ready_for_cutover" ||
      next.state === "cutover" ||
      next.state === "cleanup_eligible" ||
      next.state === "cleaned") &&
    next.verifiedCount !== next.sourceCount
  )
    throw new Error("Every frozen source object must verify before cutover");
  if (
    (next.state === "cutover" ||
      next.state === "cleanup_eligible" ||
      next.state === "cleaned") &&
    !next.cutoverAt
  )
    throw new Error("Cutover requires a durable cutover time");
  if (next.state === "cleanup_eligible" || next.state === "cleaned") {
    if (
      !next.exportBundleHash ||
      !next.exportVerifiedAt ||
      !next.recoveryDrillVerifiedAt ||
      !next.backupRetentionAcknowledgedAt
    )
      throw new Error(
        "Cleanup requires a verified export, recovery drill, and backup disclosure",
      );
  }
  if (next.state === "cleaned" && !next.cleanupAt)
    throw new Error("Plaintext cleanup requires a durable cleanup time");
  if (next.state === "rolled_back" && !next.rolledBackAt)
    throw new Error("Rollback requires a durable rollback time");
  return next;
}
