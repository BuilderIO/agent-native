import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  privateVaultMigrationItemSchema,
  privateVaultMigrationLedgerSchema,
  type PrivateVaultMigrationItem,
  type PrivateVaultMigrationLedger,
} from "../../shared/private-vault-migration.js";
import { PrivateVaultMigrationError } from "./private-vault-migration.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-migration-ledger-${process.pid}-${Date.now()}.sqlite`,
);
const scope = {
  ownerEmail: "migration-owner@example.test",
  orgId: "org:migration",
  vaultId: "21".repeat(16),
};
const migrationId = "31".repeat(16);
const timestamp = "2026-07-19T06:00:00.000Z";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let store: (typeof import("./private-vault-migration-store.js"))["sqlPrivateVaultMigrationStore"];
let evidenceStore: (typeof import("./private-vault-migration-evidence-store.js"))["sqlPrivateVaultMigrationEvidenceStore"];

function ledger(
  overrides: Partial<PrivateVaultMigrationLedger> = {},
): PrivateVaultMigrationLedger {
  return privateVaultMigrationLedgerSchema.parse({
    migrationId,
    vaultId: scope.vaultId,
    state: "preflight",
    sourceSnapshotHash: "41".repeat(32),
    sourceCount: 2,
    verifiedCount: 0,
    cutoverManifestObjectId: "42".repeat(16),
    cutoverManifestRevisionId: null,
    cutoverManifestCiphertextHash: null,
    exportBundleHash: null,
    exportVerifiedAt: null,
    recoveryDrillVerifiedAt: null,
    backupRetentionAcknowledgedAt: null,
    cutoverAt: null,
    cleanupAt: null,
    rolledBackAt: null,
    ...overrides,
  });
}

function item(index: number): PrivateVaultMigrationItem {
  return privateVaultMigrationItemSchema.parse({
    migrationId,
    sourceDocumentId: `source-${index}`,
    parentSourceDocumentId: index === 2 ? "source-1" : null,
    objectId: `${50 + index}`.repeat(16),
    sourceDigest: `${60 + index}`.repeat(32),
    state: "pending",
    sealedRevisionId: null,
    sealedCiphertextHash: null,
    verifiedAt: null,
    cleanupAt: null,
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  store = (await import("./private-vault-migration-store.js"))
    .sqlPrivateVaultMigrationStore;
  evidenceStore = (await import("./private-vault-migration-evidence-store.js"))
    .sqlPrivateVaultMigrationEvidenceStore;
  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: scope.vaultId,
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    version: 1,
    accountId: "account:migration",
    workspaceId: "workspace:migration",
    vaultState: "active",
    serverReceivedAt: timestamp,
  });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

describe("Private Vault SQL migration ledger", () => {
  it("atomically advances verified items and rejects stale transitions", async () => {
    const initial = ledger();
    const items = [item(1), item(2)];
    await expect(
      store.create({ scope, ledger: initial, items }),
    ).resolves.toEqual(initial);
    await expect(store.findActive(scope)).resolves.toMatchObject({
      ledger: { migrationId, state: "preflight" },
    });
    const copying = ledger({ state: "copying" });
    await expect(
      store.transition({ scope, previous: initial, next: copying }),
    ).resolves.toEqual(copying);
    await expect(
      store.transition({ scope, previous: initial, next: copying }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);

    const verifiedFirst = privateVaultMigrationItemSchema.parse({
      ...items[0],
      state: "verified",
      sealedRevisionId: "71".repeat(32),
      sealedCiphertextHash: "81".repeat(32),
      verifiedAt: timestamp,
    });
    const verifying = await store.verifyItem({
      scope,
      previous: copying,
      item: verifiedFirst,
    });
    expect(verifying).toMatchObject({ state: "verifying", verifiedCount: 1 });

    const verifiedSecond = privateVaultMigrationItemSchema.parse({
      ...items[1],
      state: "verified",
      sealedRevisionId: "72".repeat(32),
      sealedCiphertextHash: "82".repeat(32),
      verifiedAt: timestamp,
    });
    const ready = await store.verifyItem({
      scope,
      previous: verifying,
      item: verifiedSecond,
    });
    expect(ready).toMatchObject({
      state: "ready_for_cutover",
      verifiedCount: 2,
    });
    const current = await store.get(scope, migrationId);
    expect(current?.items.map((value) => value.state)).toEqual([
      "verified",
      "verified",
    ]);
  });

  it("permits cleanup only from the exact fully-proven CAS state", async () => {
    const current = await store.get(scope, migrationId);
    if (!current) throw new Error("missing fixture");
    const cutover = ledger({
      state: "cutover",
      verifiedCount: 2,
      cutoverManifestRevisionId: "43".repeat(32),
      cutoverManifestCiphertextHash: "44".repeat(32),
      cutoverAt: timestamp,
    });
    await store.transition({
      scope,
      previous: current.ledger,
      next: cutover,
    });
    const eligible = ledger({
      state: "cleanup_eligible",
      verifiedCount: 2,
      cutoverManifestRevisionId: "43".repeat(32),
      cutoverManifestCiphertextHash: "44".repeat(32),
      cutoverAt: timestamp,
      exportBundleHash: "91".repeat(32),
      exportVerifiedAt: timestamp,
      recoveryDrillVerifiedAt: timestamp,
      backupRetentionAcknowledgedAt: timestamp,
    });
    await store.transition({ scope, previous: cutover, next: eligible });
    await expect(
      store.markCleaned({
        scope,
        previous: eligible,
        itemIds: ["source-1", "source-2"],
        cleanedAt: timestamp,
      }),
    ).resolves.toMatchObject({ state: "cleaned", cleanupAt: timestamp });
    expect((await store.get(scope, migrationId))?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "cleaned", cleanupAt: timestamp }),
      ]),
    );
    await expect(store.findActive(scope)).resolves.toBeNull();
  });

  it("never stores source titles, bodies, or export plaintext in the ledger", async () => {
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultMigrationItems);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("Private title sentinel");
    expect(serialized).not.toContain("Private body sentinel");
    expect(serialized).not.toContain("export plaintext");
  });

  it("stores content-free evidence idempotently inside the exact tenant scope", async () => {
    const exported = {
      scope,
      endpointId: "a1".repeat(16),
      kind: "export" as const,
      migrationId,
      evidenceId: "a2".repeat(16),
      exportId: "a2".repeat(16),
      exportBundleHash: "a3".repeat(32),
      plaintextHash: "a4".repeat(32),
      sourceSnapshotHash: "41".repeat(32),
      objectCount: 2,
      createdAt: timestamp,
    };
    await expect(evidenceStore.put(exported)).resolves.toBe("stored");
    await expect(evidenceStore.put(exported)).resolves.toBe("existing");
    await expect(
      evidenceStore.put({ ...exported, plaintextHash: "ff".repeat(32) }),
    ).resolves.toBe("conflict");
    await expect(
      evidenceStore.getExport(scope, migrationId, exported.exportBundleHash),
    ).resolves.toMatchObject({
      endpointId: exported.endpointId,
      exportId: exported.exportId,
    });
    await expect(
      evidenceStore.getLatestExport(
        { ...scope, ownerEmail: "other@example.test" },
        migrationId,
      ),
    ).resolves.toBeNull();
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultMigrationEvidence);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("Private title sentinel");
    expect(serialized).not.toContain("Private body sentinel");
    expect(serialized).not.toContain("export plaintext");
  });
});
