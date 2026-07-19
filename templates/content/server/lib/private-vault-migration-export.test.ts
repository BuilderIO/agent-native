import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodePrivateVaultMigrationExportPayload,
  encodePrivateVaultMigrationExportPayload,
  PrivateVaultMigrationExportError,
} from "../../shared/private-vault-migration-export.js";
import {
  privateVaultMigrationItemSchema,
  privateVaultMigrationLedgerSchema,
  type PrivateVaultMigrationItem,
} from "../../shared/private-vault-migration.js";
import { createPrivateVaultMigrationExportBundle } from "./private-vault-migration-export.js";
import {
  PrivateVaultMigrationError,
  hashPrivateVaultMigrationSnapshot,
  hashPrivateVaultMigrationSource,
  type PrivateVaultMigrationScope,
  type PrivateVaultMigrationSourceDocument,
} from "./private-vault-migration.js";

const timestamp = "2026-07-19T06:00:00.000Z";
const scope: PrivateVaultMigrationScope = {
  ownerEmail: "owner@example.test",
  orgId: "org_test",
  vaultId: "21".repeat(16),
};

function sources(): PrivateVaultMigrationSourceDocument[] {
  return [
    {
      id: "root",
      parentId: null,
      title: "Private title sentinel",
      content: "Private body sentinel",
      description: "A private description",
      icon: "lock",
      position: 3,
      isFavorite: true,
      hideFromSearch: true,
      createdAt: "2026-07-19T04:00:00.000Z",
      updatedAt: "2026-07-19T05:00:00.000Z",
    },
    {
      id: "child",
      parentId: "root",
      title: "Nested title",
      content: "Nested body",
      description: "",
      icon: null,
      position: 1,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-07-19T04:01:00.000Z",
      updatedAt: "2026-07-19T05:01:00.000Z",
    },
  ];
}

function verifiedItems(
  sourceDocuments: readonly PrivateVaultMigrationSourceDocument[],
): PrivateVaultMigrationItem[] {
  return sourceDocuments.map((source, index) =>
    privateVaultMigrationItemSchema.parse({
      migrationId: "31".repeat(16),
      sourceDocumentId: source.id,
      parentSourceDocumentId: source.parentId,
      objectId: (index === 0 ? "41" : "42").repeat(16),
      sourceDigest: hashPrivateVaultMigrationSource(source),
      state: "verified",
      sealedRevisionId: (index === 0 ? "51" : "52").repeat(16),
      sealedCiphertextHash: (index === 0 ? "61" : "62").repeat(32),
      verifiedAt: timestamp,
      cleanupAt: null,
    }),
  );
}

function fixture() {
  const sourceDocuments = sources();
  const items = verifiedItems(sourceDocuments);
  const ledger = privateVaultMigrationLedgerSchema.parse({
    migrationId: "31".repeat(16),
    vaultId: scope.vaultId,
    state: "cutover",
    sourceSnapshotHash: hashPrivateVaultMigrationSnapshot(items),
    sourceCount: items.length,
    verifiedCount: items.length,
    exportBundleHash: null,
    exportVerifiedAt: null,
    recoveryDrillVerifiedAt: null,
    backupRetentionAcknowledgedAt: null,
    cutoverAt: timestamp,
    cleanupAt: null,
    rolledBackAt: null,
  });
  return { sourceDocuments, items, ledger };
}

describe("Private Vault canonical migration export", () => {
  it("binds every supported document field and ciphertext proof", () => {
    const { sourceDocuments, items, ledger } = fixture();
    const bundle = createPrivateVaultMigrationExportBundle({
      scope,
      ledger,
      items: [...items].reverse(),
      sources: [...sourceDocuments].reverse(),
      createdAt: timestamp,
    });
    const decoded = decodePrivateVaultMigrationExportPayload(bundle.plaintext);

    expect(decoded).toMatchObject({
      format: "agent-native-content-private-vault-export",
      version: 1,
      vaultId: scope.vaultId,
      migrationId: ledger.migrationId,
      sourceSnapshotHash: ledger.sourceSnapshotHash,
      createdAt: timestamp,
    });
    expect(
      decoded.documents.map((document) => document.sourceDocumentId),
    ).toEqual(["child", "root"]);
    expect(
      decoded.documents.find(
        (document) => document.sourceDocumentId === "root",
      ),
    ).toMatchObject({
      title: "Private title sentinel",
      content: "Private body sentinel",
      description: "A private description",
      icon: "lock",
      position: 3,
      isFavorite: true,
      hideFromSearch: true,
      objectId: "41".repeat(16),
      sealedRevisionId: "51".repeat(16),
      sealedCiphertextHash: "61".repeat(32),
    });
    expect(bundle.objectCount).toBe(2);
    expect(bundle.plaintextSha256).toBe(
      "af9795356b4ebb59fe3c5dc67d2fe9b1e5677202ad2f1338d2f0b0270afcec44",
    );
    expect(createHash("sha256").update(bundle.plaintext).digest("hex")).toBe(
      bundle.plaintextSha256,
    );
    bundle.plaintext.fill(0);
  });

  it("rejects changed source plaintext and incomplete ciphertext evidence", () => {
    const { sourceDocuments, items, ledger } = fixture();
    expect(() =>
      createPrivateVaultMigrationExportBundle({
        scope,
        ledger,
        items,
        sources: [
          { ...sourceDocuments[0]!, content: "changed after preflight" },
          sourceDocuments[1]!,
        ],
        createdAt: timestamp,
      }),
    ).toThrow(PrivateVaultMigrationError);
    expect(() =>
      createPrivateVaultMigrationExportBundle({
        scope,
        ledger,
        items: [{ ...items[0]!, state: "sealed" }, items[1]!],
        sources: sourceDocuments,
        createdAt: timestamp,
      }),
    ).toThrow(PrivateVaultMigrationError);
    expect(() =>
      createPrivateVaultMigrationExportBundle({
        scope,
        ledger,
        items: [{ ...items[0]!, migrationId: "ff".repeat(16) }, items[1]!],
        sources: sourceDocuments,
        createdAt: timestamp,
      }),
    ).toThrow(PrivateVaultMigrationError);
  });

  it("rejects noncanonical JSON, unknown fields, and cyclic hierarchies", () => {
    const { sourceDocuments, items, ledger } = fixture();
    const bundle = createPrivateVaultMigrationExportBundle({
      scope,
      ledger,
      items,
      sources: sourceDocuments,
      createdAt: timestamp,
    });
    const decoded = decodePrivateVaultMigrationExportPayload(bundle.plaintext);
    const reordered = new TextEncoder().encode(
      JSON.stringify({
        ...decoded,
        documents: [...decoded.documents].reverse(),
      }),
    );
    expect(() => decodePrivateVaultMigrationExportPayload(reordered)).toThrow(
      PrivateVaultMigrationExportError,
    );
    const unknown = new TextEncoder().encode(
      JSON.stringify({ ...decoded, unexpected: true }),
    );
    expect(() => decodePrivateVaultMigrationExportPayload(unknown)).toThrow(
      PrivateVaultMigrationExportError,
    );
    expect(() =>
      encodePrivateVaultMigrationExportPayload({
        ...decoded,
        documents: decoded.documents.map((document) => ({
          ...document,
          parentSourceDocumentId:
            document.sourceDocumentId === "root" ? "child" : "root",
        })),
      }),
    ).toThrow(PrivateVaultMigrationExportError);
    bundle.plaintext.fill(0);
    reordered.fill(0);
    unknown.fill(0);
  });
});
