import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  decodePrivateVaultContentManifest,
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  privateVaultContentDocumentSchema,
  privateVaultContentManifestSchema,
  type PrivateVaultContentDocument,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import {
  PrivateVaultContentMigrationError,
  PrivateVaultContentMigrationRuntime,
  type PrivateVaultMigrationHostedClient,
  type PrivateVaultMigrationItemProjection,
  type PrivateVaultMigrationLedgerProjection,
  type PrivateVaultMigrationSourceProjection,
  type MigrationSnapshot,
} from "./content-migration-runtime.js";

const vaultId = "21".repeat(16);
const migrationId = "31".repeat(16);
const manifestObjectId = "41".repeat(16);
const now = "2026-07-19T08:00:00.000Z";
const sources: PrivateVaultMigrationSourceProjection[] = [
  {
    id: "root",
    parentId: null,
    title: "Private title sentinel",
    content: "Private body sentinel",
    description: "",
    icon: null,
    position: 0,
    isFavorite: true,
    hideFromSearch: false,
    createdAt: "2026-07-19T06:00:00.000Z",
    updatedAt: "2026-07-19T07:00:00.000Z",
  },
  {
    id: "child",
    parentId: "root",
    title: "Child title",
    content: "Child body",
    description: "Nested",
    icon: "lock",
    position: 1,
    isFavorite: false,
    hideFromSearch: true,
    createdAt: "2026-07-19T06:01:00.000Z",
    updatedAt: "2026-07-19T07:01:00.000Z",
  },
];

function fixture() {
  const items: PrivateVaultMigrationItemProjection[] = sources.map(
    (source, index) => ({
      migrationId,
      sourceDocumentId: source.id,
      parentSourceDocumentId: source.parentId,
      objectId: (index === 0 ? "51" : "52").repeat(16),
      sourceDigest: (index === 0 ? "61" : "62").repeat(32),
      state: "pending",
      sealedRevisionId: null,
      sealedCiphertextHash: null,
    }),
  );
  let ledger: PrivateVaultMigrationLedgerProjection = {
    migrationId,
    vaultId,
    state: "preflight",
    sourceSnapshotHash: "71".repeat(32),
    sourceCount: items.length,
    verifiedCount: 0,
    cutoverManifestObjectId: manifestObjectId,
    cutoverManifestRevisionId: null,
    cutoverManifestCiphertextHash: null,
  };
  const events: string[] = [];
  const active = vi.fn(async () => null as MigrationSnapshot | null);
  const hosted: PrivateVaultMigrationHostedClient = {
    active,
    candidates: vi.fn(async () => sources.map((source) => source.id)),
    preflight: vi.fn(async () => structuredClone(ledger)),
    status: vi.fn(async () => ({
      ledger: structuredClone(ledger),
      items: structuredClone(items),
    })),
    begin: vi.fn(async () => {
      ledger = { ...ledger, state: "copying" };
      return structuredClone(ledger);
    }),
    readSource: vi.fn(async (_vaultId, _migrationId, sourceDocumentId) => {
      const source = sources.find(
        (candidate) => candidate.id === sourceDocumentId,
      );
      if (!source) throw new Error();
      return structuredClone(source);
    }),
    verifyItem: vi.fn(async (input) => {
      const item = items.find(
        (candidate) => candidate.sourceDocumentId === input.sourceDocumentId,
      );
      if (!item) throw new Error();
      Object.assign(item, {
        state: "verified",
        sealedRevisionId: input.revisionId,
        sealedCiphertextHash: input.ciphertextHash,
      });
      ledger = {
        ...ledger,
        state: items.every((candidate) => candidate.state === "verified")
          ? "ready_for_cutover"
          : "verifying",
        verifiedCount: items.filter(
          (candidate) => candidate.state === "verified",
        ).length,
      };
      return structuredClone(ledger);
    }),
    cutover: vi.fn(async (input) => {
      events.push("cutover");
      ledger = {
        ...ledger,
        state: "cutover",
        cutoverManifestRevisionId: input.revisionId,
        cutoverManifestCiphertextHash: input.ciphertextHash,
      };
      return structuredClone(ledger);
    }),
    cleanup: vi.fn(async () => {
      ledger = { ...ledger, state: "cleaned" };
      return structuredClone(ledger);
    }),
  };
  const stored = new Map<
    string,
    { bytes: Uint8Array; objectType: "document" | "vault-manifest" }
  >();
  let revision = 0;
  const openedBuffers: Uint8Array[] = [];
  const objects = {
    sealAndUpload: vi.fn(async (input) => {
      revision += 1;
      const revisionId = revision.toString(16).padStart(64, "0");
      const bytes = input.plaintext.slice();
      stored.set(`${input.objectId}:${revisionId}`, {
        bytes,
        objectType:
          input.contentType === PRIVATE_VAULT_CONTENT_TYPE
            ? "document"
            : "vault-manifest",
      });
      events.push(`upload:${input.objectId}`);
      return {
        revisionId,
        ciphertextHash: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
    downloadAndOpen: vi.fn(async (input) => {
      const value = stored.get(`${input.objectId}:${input.revisionId}`);
      if (!value) throw new Error();
      const plaintext = value.bytes.slice();
      openedBuffers.push(plaintext);
      return { plaintext, metadata: { objectType: value.objectType } };
    }),
  };
  let head: PrivateVaultLocalManifestHead | null = null;
  const documents = new Map<string, PrivateVaultContentDocument>();
  const index = {
    readManifest: vi.fn(async () => structuredClone(head)),
    readDocument: vi.fn(async (_vaultId, objectId, revisionId) =>
      structuredClone(documents.get(`${objectId}:${revisionId}`) ?? null),
    ),
    writeDocument: vi.fn(async (_vaultId, revisionId, document) => {
      documents.set(`${document.id}:${revisionId}`, structuredClone(document));
      events.push(`local-document:${document.id}`);
    }),
    writeManifest: vi.fn(async (next) => {
      events.push("local-manifest");
      head = structuredClone(next);
    }),
  };
  const runtime = new PrivateVaultContentMigrationRuntime({
    hosted,
    objects,
    index,
    now: () => now,
  });
  return {
    runtime,
    hosted,
    active,
    objects,
    index,
    items,
    stored,
    openedBuffers,
    events,
    head: () => head,
    ledger: () => ledger,
    setLedger: (next: PrivateVaultMigrationLedgerProjection) => {
      ledger = next;
    },
  };
}

describe("Private Vault signed-Desktop migration copier", () => {
  it("lists only the bounded hosted Standard Cloud candidate IDs", async () => {
    const source = fixture();
    await expect(source.runtime.listCandidates(vaultId)).resolves.toEqual([
      "root",
      "child",
    ]);
  });

  it("adopts an active preflight ledger instead of creating a second migration", async () => {
    const source = fixture();
    source.active.mockResolvedValueOnce({
      ledger: structuredClone(source.ledger()),
      items: structuredClone(source.items),
    });
    await expect(
      source.runtime.migrate({
        vaultId,
        sourceDocumentIds: ["root", "child"],
      }),
    ).resolves.toMatchObject({ state: "cutover" });
    expect(source.hosted.preflight).not.toHaveBeenCalled();
  });

  it("stages and verifies every document before one encrypted manifest cuts over", async () => {
    const source = fixture();
    await expect(
      source.runtime.migrate({
        vaultId,
        sourceDocumentIds: ["root", "child"],
      }),
    ).resolves.toMatchObject({ state: "cutover", verifiedCount: 2 });

    const uploads = source.objects.sealAndUpload.mock.calls.map(
      ([input]) => input,
    );
    expect(uploads.map((input) => input.contentType)).toEqual([
      PRIVATE_VAULT_CONTENT_TYPE,
      PRIVATE_VAULT_CONTENT_TYPE,
      PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
    ]);
    expect(uploads[2]?.objectId).toBe(manifestObjectId);
    const manifestRevisionId = source.ledger().cutoverManifestRevisionId!;
    const manifest = decodePrivateVaultContentManifest(
      source.stored.get(`${manifestObjectId}:${manifestRevisionId}`)!.bytes,
    );
    expect(manifest.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectId: "51".repeat(16),
          parentId: null,
        }),
        expect.objectContaining({
          objectId: "52".repeat(16),
          parentId: "51".repeat(16),
        }),
      ]),
    );
    const rootRevisionId = source.items[0]!.sealedRevisionId!;
    await expect(
      source.index.readDocument(
        vaultId,
        source.items[0]!.objectId,
        rootRevisionId,
      ),
    ).resolves.toMatchObject({ description: "" });
    expect(source.events.indexOf("cutover")).toBeLessThan(
      source.events.indexOf("local-manifest"),
    );
    expect(source.head()?.objectId).toBe(manifestObjectId);
    expect(
      source.openedBuffers.every((bytes) => bytes.every((byte) => byte === 0)),
    ).toBe(true);
  });

  it("re-opens every encrypted object before attended source cleanup", async () => {
    const source = fixture();
    await source.runtime.migrate({
      vaultId,
      sourceDocumentIds: ["root", "child"],
    });
    source.setLedger({ ...source.ledger(), state: "cleanup_eligible" });
    source.objects.downloadAndOpen.mockClear();
    await expect(
      source.runtime.cleanup(vaultId, migrationId),
    ).resolves.toMatchObject({ state: "cleaned" });
    expect(source.objects.downloadAndOpen).toHaveBeenCalledTimes(3);
    expect(source.hosted.cleanup).toHaveBeenCalledWith(vaultId, migrationId);
  });

  it("resumes a crash after hosted cutover by hydrating exact ciphertext before local visibility", async () => {
    const source = fixture();
    await source.runtime.migrate({
      vaultId,
      sourceDocumentIds: ["root", "child"],
    });
    const cutover = source.ledger();
    const fresh = fixture();
    fresh.setLedger(cutover);
    for (const [index, item] of fresh.items.entries()) {
      const prior = source.items[index]!;
      Object.assign(item, structuredClone(prior));
    }
    for (const [key, value] of source.stored)
      fresh.stored.set(key, {
        bytes: value.bytes.slice(),
        objectType: value.objectType,
      });

    await expect(
      fresh.runtime.migrate({ vaultId, migrationId }),
    ).resolves.toMatchObject({ state: "cutover" });
    expect(fresh.objects.sealAndUpload).not.toHaveBeenCalled();
    expect(fresh.hosted.cutover).not.toHaveBeenCalled();
    expect(fresh.head()).toEqual(source.head());
    expect(fresh.events.at(-1)).toBe("local-manifest");
  });

  it("resumes ready-for-cutover from verified ciphertext without rereading hosted plaintext", async () => {
    const source = fixture();
    await source.runtime.migrate({
      vaultId,
      sourceDocumentIds: ["root", "child"],
    });
    const fresh = fixture();
    fresh.setLedger({
      ...source.ledger(),
      state: "ready_for_cutover",
      cutoverManifestRevisionId: null,
      cutoverManifestCiphertextHash: null,
    });
    for (const [index, item] of fresh.items.entries())
      Object.assign(item, structuredClone(source.items[index]!));
    for (const [key, value] of source.stored)
      if (!key.startsWith(`${manifestObjectId}:`))
        fresh.stored.set(key, {
          bytes: value.bytes.slice(),
          objectType: value.objectType,
        });

    await expect(
      fresh.runtime.migrate({ vaultId, migrationId }),
    ).resolves.toMatchObject({ state: "cutover" });
    expect(fresh.hosted.readSource).not.toHaveBeenCalled();
    expect(fresh.objects.downloadAndOpen).toHaveBeenCalledTimes(5);
    expect(fresh.head()?.objectId).toBe(manifestObjectId);
  });

  it("never installs a document manifest when the hosted coordinate opens as the wrong object type", async () => {
    const source = fixture();
    await source.runtime.migrate({
      vaultId,
      sourceDocumentIds: ["root", "child"],
    });
    const ledger = source.ledger();
    const manifestKey = `${manifestObjectId}:${ledger.cutoverManifestRevisionId}`;
    const stored = source.stored.get(manifestKey)!;
    source.stored.set(manifestKey, { ...stored, objectType: "document" });
    const fresh = fixture();
    fresh.setLedger(ledger);
    for (const [index, item] of fresh.items.entries())
      Object.assign(item, structuredClone(source.items[index]!));
    for (const [key, value] of source.stored)
      fresh.stored.set(key, {
        bytes: value.bytes.slice(),
        objectType: value.objectType,
      });

    await expect(
      fresh.runtime.migrate({ vaultId, migrationId }),
    ).rejects.toBeInstanceOf(PrivateVaultContentMigrationError);
    expect(fresh.index.writeManifest).not.toHaveBeenCalled();
  });
});
