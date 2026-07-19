import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  encodePrivateVaultContentDocument,
  privateVaultContentDocumentSchema,
} from "./content-document-codec.js";
import {
  encodePrivateVaultContentMigrationExport,
  PrivateVaultContentMigrationExportError,
  PrivateVaultContentMigrationExportRuntime,
} from "./content-migration-export.js";
import type {
  MigrationSnapshot,
  PrivateVaultMigrationSourceProjection,
} from "./content-migration-runtime.js";

const timestamp = "2026-07-19T06:00:00.000Z";
const vaultId = "21".repeat(16);
const migrationId = "31".repeat(16);
const manifestObjectId = "71".repeat(16);
const manifestRevisionId = "72".repeat(32);
const manifestHash = "73".repeat(32);

const sources: PrivateVaultMigrationSourceProjection[] = [
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

function sourceDigest(source: PrivateVaultMigrationSourceProjection) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        1,
        source.id,
        source.parentId,
        source.title,
        source.content,
        source.description,
        source.icon,
        source.position,
        source.isFavorite,
        source.hideFromSearch,
        source.createdAt,
        source.updatedAt,
      ]),
    )
    .digest("hex");
}

function fixture() {
  const items = sources.map((source, index) => ({
    migrationId,
    sourceDocumentId: source.id,
    parentSourceDocumentId: source.parentId,
    objectId: (index === 0 ? "41" : "42").repeat(16),
    sourceDigest: sourceDigest(source),
    state: "verified" as const,
    sealedRevisionId: (index === 0 ? "51" : "52").repeat(32),
    sealedCiphertextHash: (index === 0 ? "61" : "62").repeat(32),
  }));
  const sourceSnapshotHash = createHash("sha256")
    .update(
      JSON.stringify(
        [...items]
          .sort((left, right) =>
            left.sourceDocumentId < right.sourceDocumentId ? -1 : 1,
          )
          .map((item) => [
            item.sourceDocumentId,
            item.sourceDigest,
            item.objectId,
          ]),
      ),
    )
    .digest("hex");
  const snapshot: MigrationSnapshot = {
    ledger: {
      migrationId,
      vaultId,
      state: "cutover",
      sourceSnapshotHash,
      sourceCount: 2,
      verifiedCount: 2,
      cutoverManifestObjectId: manifestObjectId,
      cutoverManifestRevisionId: manifestRevisionId,
      cutoverManifestCiphertextHash: manifestHash,
    },
    items,
  };
  const plaintextByRevision = new Map(
    sources.map((source, index) => {
      const document = privateVaultContentDocumentSchema.parse({
        version: 1,
        kind: "content-document",
        id: items[index]!.objectId,
        parentId: source.parentId
          ? items.find((item) => item.sourceDocumentId === source.parentId)!
              .objectId
          : null,
        title: source.title,
        content: source.content,
        description: source.description,
        icon: source.icon,
        position: source.position,
        isFavorite: source.isFavorite,
        hideFromSearch: source.hideFromSearch,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
      return [
        items[index]!.sealedRevisionId,
        encodePrivateVaultContentDocument(document),
      ] as const;
    }),
  );
  const openedBuffers: Uint8Array[] = [];
  const objects = {
    downloadAndOpen: vi.fn(async ({ revisionId }) => {
      const plaintext = plaintextByRevision.get(revisionId)?.slice();
      if (!plaintext) throw new Error();
      openedBuffers.push(plaintext);
      return { plaintext, metadata: { objectType: "document" as const } };
    }),
  };
  let sealedPlaintext: Uint8Array | undefined;
  let archiveWorking: Uint8Array | undefined;
  const archiveCopy = Uint8Array.of(0xa4, 1, 2, 3);
  const native = {
    sealExportArchive: vi.fn(async (input) => {
      sealedPlaintext = input.plaintext.slice();
      archiveWorking = archiveCopy.slice();
      return { vaultId, exportId: input.exportId, archive: archiveWorking };
    }),
  };
  let savedArchive: Uint8Array | undefined;
  const writer = {
    save: vi.fn(async ({ archive }) => {
      savedArchive = archive.slice();
    }),
  };
  const evidence = { append: vi.fn(async () => ({ state: "stored" })) };
  const status = vi.fn(async () => structuredClone(snapshot));
  const runtime = new PrivateVaultContentMigrationExportRuntime({
    hosted: { status },
    objects,
    native,
    writer,
    evidence,
    now: () => new Date(timestamp),
    exportId: () => "81".repeat(16),
  });
  return {
    runtime,
    snapshot,
    status,
    objects,
    native,
    writer,
    evidence,
    openedBuffers,
    sealedPlaintext: () => sealedPlaintext,
    archiveWorking: () => archiveWorking,
    savedArchive: () => savedArchive,
  };
}

describe("Private Vault signed-Desktop migration export", () => {
  it("matches the frozen Content payload vector before native recovery sealing", () => {
    const source = fixture();
    const documents = sources.map((document, index) => ({
      sourceDocumentId: document.id,
      parentSourceDocumentId: document.parentId,
      objectId: source.snapshot.items[index]!.objectId,
      sourceDigest: source.snapshot.items[index]!.sourceDigest,
      sealedRevisionId: source.snapshot.items[index]!.sealedRevisionId!,
      sealedCiphertextHash: source.snapshot.items[index]!.sealedCiphertextHash!,
      title: document.title,
      content: document.content,
      description: document.description,
      icon: document.icon,
      position: document.position,
      isFavorite: document.isFavorite,
      hideFromSearch: document.hideFromSearch,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
    const encoded = encodePrivateVaultContentMigrationExport({
      format: "agent-native-content-private-vault-export",
      version: 1,
      vaultId,
      migrationId,
      sourceSnapshotHash: source.snapshot.ledger.sourceSnapshotHash,
      cutoverManifestObjectId: manifestObjectId,
      cutoverManifestRevisionId: manifestRevisionId,
      cutoverManifestCiphertextHash: manifestHash,
      createdAt: timestamp,
      documents,
    });
    expect(createHash("sha256").update(encoded).digest("hex")).toBe(
      "83f137776a4b2e7c7ff30b413cf0f2eb4fa15a58adf35c8ec3e9bfc48401a1b4",
    );
    encoded.fill(0);
  });

  it("seals verified encrypted documents natively and wipes every byte buffer after saving", async () => {
    const source = fixture();
    await expect(source.runtime.export(vaultId, migrationId)).resolves.toEqual({
      exportId: "81".repeat(16),
      plaintextSha256:
        "83f137776a4b2e7c7ff30b413cf0f2eb4fa15a58adf35c8ec3e9bfc48401a1b4",
      archiveSha256: createHash("sha256")
        .update(Uint8Array.of(0xa4, 1, 2, 3))
        .digest("hex"),
      objectCount: 2,
    });
    expect(source.native.sealExportArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultId,
        sourceSnapshotHash: source.snapshot.ledger.sourceSnapshotHash,
        objectCount: 2,
      }),
    );
    expect(source.writer.save).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: expect.stringMatching(/\.anpvault$/),
      }),
    );
    expect(source.evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "export",
        vaultId,
        migrationId,
        exportId: "81".repeat(16),
        sourceSnapshotHash: source.snapshot.ledger.sourceSnapshotHash,
        objectCount: 2,
      }),
    );
    expect(source.savedArchive()).toEqual(Uint8Array.of(0xa4, 1, 2, 3));
    expect(
      source.openedBuffers.every((bytes) => bytes.every((byte) => byte === 0)),
    ).toBe(true);
    expect(source.archiveWorking()).toEqual(new Uint8Array(4));
  });

  it("fails closed before native sealing for an uncutover or structurally inconsistent ledger", async () => {
    const source = fixture();
    source.status.mockResolvedValueOnce({
      ...structuredClone(source.snapshot),
      ledger: {
        ...structuredClone(source.snapshot.ledger),
        state: "ready_for_cutover",
      },
    });
    await expect(
      source.runtime.export(vaultId, migrationId),
    ).rejects.toBeInstanceOf(PrivateVaultContentMigrationExportError);
    expect(source.native.sealExportArchive).not.toHaveBeenCalled();
  });
});
