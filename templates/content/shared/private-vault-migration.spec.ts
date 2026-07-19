import { describe, expect, it } from "vitest";

import {
  assertPrivateVaultMigrationTransition,
  privateVaultMigrationItemSchema,
  type PrivateVaultMigrationLedger,
} from "./private-vault-migration.js";

const timestamp = "2026-07-19T05:00:00.000Z";
const base: PrivateVaultMigrationLedger = {
  migrationId: "21".repeat(16),
  vaultId: "31".repeat(16),
  state: "preflight",
  sourceSnapshotHash: "41".repeat(32),
  sourceCount: 2,
  verifiedCount: 0,
  exportBundleHash: null,
  exportVerifiedAt: null,
  recoveryDrillVerifiedAt: null,
  backupRetentionAcknowledgedAt: null,
  cutoverAt: null,
  cleanupAt: null,
  rolledBackAt: null,
};

describe("Private Vault migration contract", () => {
  it("advances only after every frozen source object verifies", () => {
    const copying = { ...base, state: "copying" as const };
    expect(assertPrivateVaultMigrationTransition(base, copying)).toEqual(
      copying,
    );
    const verifying = { ...copying, state: "verifying" as const };
    expect(assertPrivateVaultMigrationTransition(copying, verifying)).toEqual(
      verifying,
    );
    expect(() =>
      assertPrivateVaultMigrationTransition(verifying, {
        ...verifying,
        state: "ready_for_cutover",
        verifiedCount: 1,
      }),
    ).toThrow("Every frozen source object");
    const ready = {
      ...verifying,
      state: "ready_for_cutover" as const,
      verifiedCount: 2,
    };
    expect(assertPrivateVaultMigrationTransition(verifying, ready)).toEqual(
      ready,
    );
  });

  it("requires export, recovery, and backup disclosure before cleanup", () => {
    const cutover = {
      ...base,
      state: "cutover" as const,
      verifiedCount: 2,
      cutoverAt: timestamp,
    };
    expect(() =>
      assertPrivateVaultMigrationTransition(cutover, {
        ...cutover,
        state: "cleanup_eligible",
      }),
    ).toThrow("verified export, recovery drill, and backup disclosure");
    const eligible = {
      ...cutover,
      state: "cleanup_eligible" as const,
      exportBundleHash: "51".repeat(32),
      exportVerifiedAt: timestamp,
      recoveryDrillVerifiedAt: timestamp,
      backupRetentionAcknowledgedAt: timestamp,
    };
    expect(assertPrivateVaultMigrationTransition(cutover, eligible)).toEqual(
      eligible,
    );
    expect(() =>
      assertPrivateVaultMigrationTransition(eligible, {
        ...eligible,
        state: "cleaned",
      }),
    ).toThrow("cleanup time");
  });

  it("permits explicit rollback before cleanup and never reopens a terminal ledger", () => {
    const copying = { ...base, state: "copying" as const };
    const rolledBack = {
      ...copying,
      state: "rolled_back" as const,
      rolledBackAt: timestamp,
    };
    expect(assertPrivateVaultMigrationTransition(copying, rolledBack)).toEqual(
      rolledBack,
    );
    expect(() =>
      assertPrivateVaultMigrationTransition(rolledBack, copying),
    ).toThrow("transition is not allowed");
  });

  it("binds each verified item to the exact source and ciphertext digests", () => {
    expect(
      privateVaultMigrationItemSchema.parse({
        migrationId: base.migrationId,
        sourceDocumentId: "legacy-doc",
        parentSourceDocumentId: null,
        objectId: "61".repeat(16),
        sourceDigest: "71".repeat(32),
        state: "verified",
        sealedRevisionId: "81".repeat(16),
        sealedCiphertextHash: "91".repeat(32),
        verifiedAt: timestamp,
        cleanupAt: null,
      }).state,
    ).toBe("verified");
    expect(
      privateVaultMigrationItemSchema.safeParse({
        migrationId: base.migrationId,
        sourceDocumentId: "legacy-doc",
        parentSourceDocumentId: null,
        objectId: "61".repeat(16),
        sourceDigest: "71".repeat(32),
        state: "verified",
        sealedRevisionId: null,
        sealedCiphertextHash: null,
        verifiedAt: timestamp,
        cleanupAt: null,
      }).success,
    ).toBe(false);
  });
});
