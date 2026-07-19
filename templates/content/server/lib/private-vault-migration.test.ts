import { describe, expect, it, vi } from "vitest";

import {
  assertPrivateVaultMigrationTransition,
  privateVaultMigrationLedgerSchema,
  type PrivateVaultMigrationItem,
  type PrivateVaultMigrationLedger,
} from "../../shared/private-vault-migration.js";
import {
  PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
  PrivateVaultMigrationCoordinator,
  PrivateVaultMigrationError,
  hashPrivateVaultMigrationSource,
  type PrivateVaultMigrationCiphertextTarget,
  type PrivateVaultMigrationScope,
  type PrivateVaultMigrationSource,
  type PrivateVaultMigrationSourceDocument,
  type PrivateVaultMigrationStore,
} from "./private-vault-migration.js";

const scope: PrivateVaultMigrationScope = {
  ownerEmail: "owner@example.test",
  orgId: "org_test",
  vaultId: "21".repeat(16),
};
const now = "2026-07-19T05:30:00.000Z";

function documents(): PrivateVaultMigrationSourceDocument[] {
  return [
    {
      id: "root",
      parentId: null,
      title: "Private title sentinel",
      content: "Private body sentinel",
      position: 0,
      updatedAt: "2026-07-19T05:00:00.000Z",
    },
    {
      id: "child",
      parentId: "root",
      title: "Child",
      content: "Nested body",
      position: 0,
      updatedAt: "2026-07-19T05:01:00.000Z",
    },
  ];
}

class MemorySource implements PrivateVaultMigrationSource {
  readonly values = new Map(
    documents().map((document) => [document.id, document]),
  );
  readonly cleanup = vi.fn(async (_scope, ids: readonly string[]) => {
    for (const id of ids) this.values.delete(id);
  });

  async freeze(_scope: PrivateVaultMigrationScope, ids: readonly string[]) {
    return ids.flatMap((id) => {
      const value = this.values.get(id);
      return value ? [{ ...value }] : [];
    });
  }

  async read(_scope: PrivateVaultMigrationScope, id: string) {
    const value = this.values.get(id);
    return value ? { ...value } : null;
  }
}

class MemoryStore implements PrivateVaultMigrationStore {
  ledger: PrivateVaultMigrationLedger | null = null;
  items: PrivateVaultMigrationItem[] = [];

  async create(input: {
    ledger: PrivateVaultMigrationLedger;
    items: readonly PrivateVaultMigrationItem[];
  }) {
    if (this.ledger) throw new Error("duplicate");
    this.ledger = structuredClone(input.ledger);
    this.items = [...structuredClone(input.items)];
    return structuredClone(this.ledger);
  }

  async get(_scope: PrivateVaultMigrationScope, migrationId: string) {
    return this.ledger?.migrationId === migrationId
      ? {
          ledger: structuredClone(this.ledger),
          items: structuredClone(this.items),
        }
      : null;
  }

  async transition(input: {
    previous: PrivateVaultMigrationLedger;
    next: PrivateVaultMigrationLedger;
  }) {
    if (
      !this.ledger ||
      this.ledger.state !== input.previous.state ||
      this.ledger.verifiedCount !== input.previous.verifiedCount
    )
      throw new Error("stale");
    this.ledger = structuredClone(
      assertPrivateVaultMigrationTransition(input.previous, input.next),
    );
    return structuredClone(this.ledger);
  }

  async verifyItem(input: {
    previous: PrivateVaultMigrationLedger;
    item: PrivateVaultMigrationItem;
  }) {
    if (!this.ledger || this.ledger.state !== input.previous.state)
      throw new Error("stale");
    const index = this.items.findIndex(
      (item) => item.sourceDocumentId === input.item.sourceDocumentId,
    );
    if (index < 0 || this.items[index]!.state === "verified")
      throw new Error("stale");
    this.items[index] = structuredClone(input.item);
    const verifiedCount = this.items.filter(
      (item) => item.state === "verified",
    ).length;
    const state =
      verifiedCount === this.items.length ? "ready_for_cutover" : "verifying";
    const next = privateVaultMigrationLedgerSchema.parse({
      ...input.previous,
      state,
      verifiedCount,
    });
    this.ledger = assertPrivateVaultMigrationTransition(input.previous, next);
    return structuredClone(this.ledger);
  }

  async markCleaned(input: {
    previous: PrivateVaultMigrationLedger;
    itemIds: readonly string[];
    cleanedAt: string;
  }) {
    if (!this.ledger || this.ledger.state !== input.previous.state)
      throw new Error("stale");
    for (const item of this.items) {
      if (!input.itemIds.includes(item.sourceDocumentId))
        throw new Error("scope");
      item.state = "cleaned";
      item.cleanupAt = input.cleanedAt;
    }
    const next = privateVaultMigrationLedgerSchema.parse({
      ...input.previous,
      state: "cleaned",
      cleanupAt: input.cleanedAt,
    });
    this.ledger = assertPrivateVaultMigrationTransition(input.previous, next);
    return structuredClone(this.ledger);
  }
}

function harness() {
  const source = new MemorySource();
  const store = new MemoryStore();
  const target: PrivateVaultMigrationCiphertextTarget = {
    verify: vi.fn(
      async ({ ciphertextHash }) => ciphertextHash === "41".repeat(32),
    ),
    rollback: vi.fn(async () => undefined),
    verifyExport: vi.fn(
      async ({ exportBundleHash }) => exportBundleHash === "51".repeat(32),
    ),
    verifyRecoveryDrill: vi.fn(
      async ({ recoveryDrillId }) => recoveryDrillId === "61".repeat(16),
    ),
  };
  return {
    source,
    store,
    target,
    coordinator: new PrivateVaultMigrationCoordinator(
      source,
      target,
      store,
      () => now,
    ),
  };
}

describe("Private Vault resumable migration coordinator", () => {
  it("freezes a hierarchy and refuses changed plaintext before disclosure or verification", async () => {
    const { coordinator, source, store } = harness();
    const ledger = await coordinator.preflight(scope, ["root", "child"]);
    expect(ledger).toMatchObject({ state: "preflight", sourceCount: 2 });
    expect(JSON.stringify(store)).not.toContain("Private body sentinel");
    await coordinator.begin(scope, ledger.migrationId);
    expect(
      hashPrivateVaultMigrationSource(
        await coordinator.readSource(scope, ledger.migrationId, "root"),
      ),
    ).toBe(
      store.items.find((item) => item.sourceDocumentId === "root")!
        .sourceDigest,
    );
    source.values.set("root", {
      ...source.values.get("root")!,
      content: "changed after preflight",
    });
    await expect(
      coordinator.readSource(scope, ledger.migrationId, "root"),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
  });

  it("verifies every exact ciphertext before cutover and is idempotent per item", async () => {
    const { coordinator, store } = harness();
    const ledger = await coordinator.preflight(scope, ["root", "child"]);
    await coordinator.begin(scope, ledger.migrationId);
    const root = store.items.find((item) => item.sourceDocumentId === "root")!;
    await expect(
      coordinator.verifyItem({
        scope,
        migrationId: ledger.migrationId,
        sourceDocumentId: "root",
        revisionId: "31".repeat(16),
        ciphertextHash: "ff".repeat(32),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
    const first = await coordinator.verifyItem({
      scope,
      migrationId: ledger.migrationId,
      sourceDocumentId: "root",
      revisionId: "31".repeat(16),
      ciphertextHash: "41".repeat(32),
    });
    expect(first).toMatchObject({ state: "verifying", verifiedCount: 1 });
    expect(
      await coordinator.verifyItem({
        scope,
        migrationId: ledger.migrationId,
        sourceDocumentId: "root",
        revisionId: "31".repeat(16),
        ciphertextHash: "41".repeat(32),
      }),
    ).toEqual(first);
    const child = store.items.find(
      (item) => item.sourceDocumentId === "child",
    )!;
    expect(root.objectId).not.toBe(child.objectId);
    const ready = await coordinator.verifyItem({
      scope,
      migrationId: ledger.migrationId,
      sourceDocumentId: "child",
      revisionId: "32".repeat(16),
      ciphertextHash: "41".repeat(32),
    });
    expect(ready).toMatchObject({
      state: "ready_for_cutover",
      verifiedCount: 2,
    });
    await expect(
      coordinator.cutover(scope, ledger.migrationId),
    ).resolves.toMatchObject({ state: "cutover", cutoverAt: now });
  });

  it("requires independently verified export and recovery evidence before cleanup", async () => {
    const { coordinator, source, store } = harness();
    const ledger = await coordinator.preflight(scope, ["root", "child"]);
    await coordinator.begin(scope, ledger.migrationId);
    for (const [index, sourceDocumentId] of ["root", "child"].entries())
      await coordinator.verifyItem({
        scope,
        migrationId: ledger.migrationId,
        sourceDocumentId,
        revisionId: (index ? "32" : "31").repeat(16),
        ciphertextHash: "41".repeat(32),
      });
    await coordinator.cutover(scope, ledger.migrationId);
    await expect(
      coordinator.recordCleanupProof({
        scope,
        migrationId: ledger.migrationId,
        exportBundleHash: "51".repeat(32),
        recoveryDrillId: "61".repeat(16),
        backupDisclosureVersion: "wrong-version",
      }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
    await coordinator.recordCleanupProof({
      scope,
      migrationId: ledger.migrationId,
      exportBundleHash: "51".repeat(32),
      recoveryDrillId: "61".repeat(16),
      backupDisclosureVersion:
        PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
    });
    await expect(
      coordinator.cleanup(scope, ledger.migrationId),
    ).resolves.toMatchObject({ state: "cleaned", cleanupAt: now });
    expect(source.cleanup).toHaveBeenCalledWith(scope, ["root", "child"]);
    expect(store.items.every((item) => item.state === "cleaned")).toBe(true);
  });

  it("rolls encrypted copies back without deleting Standard Cloud sources", async () => {
    const { coordinator, source, store, target } = harness();
    const ledger = await coordinator.preflight(scope, ["root", "child"]);
    await coordinator.begin(scope, ledger.migrationId);
    await coordinator.verifyItem({
      scope,
      migrationId: ledger.migrationId,
      sourceDocumentId: "root",
      revisionId: "31".repeat(16),
      ciphertextHash: "41".repeat(32),
    });
    await expect(
      coordinator.rollback(scope, ledger.migrationId),
    ).resolves.toMatchObject({ state: "rolled_back", rolledBackAt: now });
    expect(target.rollback).toHaveBeenCalledWith({
      scope,
      objectIds: [
        store.items.find((item) => item.sourceDocumentId === "root")!.objectId,
      ],
    });
    expect(source.values.size).toBe(2);
    expect(source.cleanup).not.toHaveBeenCalled();
  });
});
