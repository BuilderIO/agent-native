import { describe, expect, it, vi } from "vitest";

import {
  decodePrivateVaultContentDocument,
  decodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  type PrivateVaultContentDocument,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import { PrivateVaultContentMutations } from "./content-document-mutations.js";

const vaultId = "11".repeat(16);
const documentId = "22".repeat(16);
const firstManifestId = "33".repeat(16);
const secondManifestId = "44".repeat(16);
const thirdManifestId = "66".repeat(16);

function harness() {
  let head: PrivateVaultLocalManifestHead | null = null;
  const documents = new Map<string, PrivateVaultContentDocument>();
  const uploads: Parameters<
    ConstructorParameters<
      typeof PrivateVaultContentMutations
    >[0]["gateway"]["sealAndUpload"]
  >[0][] = [];
  let revisionCounter = 5;
  const gateway = {
    sealAndUpload: vi.fn(async (input: (typeof uploads)[number]) => {
      uploads.push({ ...input, plaintext: input.plaintext.slice() });
      return { revisionId: String(revisionCounter++).repeat(64) };
    }),
  };
  const index = {
    readManifest: vi.fn(async () => head),
    readDocument: vi.fn(
      async (_vaultId: string, objectId: string, revisionId: string) =>
        documents.get(`${objectId}:${revisionId}`) ?? null,
    ),
    writeDocument: vi.fn(
      async (
        _vaultId: string,
        revisionId: string,
        document: PrivateVaultContentDocument,
      ) => {
        documents.set(`${document.id}:${revisionId}`, document);
      },
    ),
    writeManifest: vi.fn(async (value: PrivateVaultLocalManifestHead) => {
      head = value;
    }),
    deleteDocument: vi.fn(async (_vaultId: string, objectId: string) => {
      for (const key of documents.keys()) {
        if (key.startsWith(`${objectId}:`)) documents.delete(key);
      }
    }),
  };
  const ids = [documentId, firstManifestId, secondManifestId, thirdManifestId];
  const mutations = new PrivateVaultContentMutations({
    gateway,
    index,
    now: () => "2026-07-18T20:00:00.000Z",
    objectId: () => ids.shift()!,
  });
  return { gateway, index, mutations, uploads, head: () => head };
}

describe("PrivateVaultContentMutations", () => {
  it("creates a document revision, then an encrypted manifest head", async () => {
    const source = harness();
    await expect(
      source.mutations.createDocument(vaultId, {
        title: "Encrypted title",
        content: "Encrypted body",
      }),
    ).resolves.toMatchObject({ id: documentId, title: "Encrypted title" });

    expect(source.uploads).toHaveLength(2);
    expect(source.uploads[0]).toMatchObject({
      objectId: documentId,
      revision: 1,
      contentType: PRIVATE_VAULT_CONTENT_TYPE,
    });
    expect(
      decodePrivateVaultContentDocument(source.uploads[0].plaintext),
    ).toMatchObject({ title: "Encrypted title", content: "Encrypted body" });
    expect(source.uploads[1]).toMatchObject({
      objectId: firstManifestId,
      revision: 1,
      contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
    });
    expect(
      decodePrivateVaultContentManifest(source.uploads[1].plaintext),
    ).toMatchObject({
      generation: 1,
      previousManifest: null,
      documents: [{ objectId: documentId, parentId: null, position: 0 }],
    });
    expect(source.head()).toMatchObject({
      objectId: firstManifestId,
      revisionId: "6".repeat(64),
    });
  });

  it("edits from the cached head and appends immutable version history", async () => {
    const source = harness();
    await source.mutations.createDocument(vaultId, {
      title: "First",
      content: "One",
    });
    await source.mutations.updateDocument(vaultId, documentId, {
      title: "Second",
      content: "Two",
    });

    expect(source.uploads[2]).toMatchObject({
      objectId: documentId,
      revision: 2,
      parentRevisionIds: ["5".repeat(64)],
    });
    const manifest = decodePrivateVaultContentManifest(
      source.uploads[3].plaintext,
    );
    expect(manifest).toMatchObject({
      generation: 2,
      previousManifest: {
        objectId: firstManifestId,
        revisionId: "6".repeat(64),
      },
    });
    expect(
      manifest.documents[0].revisions.map((value) => value.revision),
    ).toEqual([1, 2]);
  });

  it("does not advance local state when the manifest upload fails", async () => {
    const source = harness();
    source.gateway.sealAndUpload
      .mockResolvedValueOnce({ revisionId: "5".repeat(64) })
      .mockRejectedValueOnce(new Error("offline"));
    await expect(
      source.mutations.createDocument(vaultId, { title: "Waiting" }),
    ).rejects.toThrow("offline");
    expect(source.index.writeDocument).not.toHaveBeenCalled();
    expect(source.index.writeManifest).not.toHaveBeenCalled();
    expect(source.head()).toBeNull();
  });

  it("rejects moving a document beneath its descendant before upload", async () => {
    const source = harness();
    await source.mutations.createDocument(vaultId, { title: "Parent" });
    const childId = "55".repeat(16);
    await source.mutations.createDocument(vaultId, {
      id: childId,
      parentId: documentId,
      title: "Child",
    });
    const callsBeforeMove = source.gateway.sealAndUpload.mock.calls.length;
    await expect(
      source.mutations.updateDocument(vaultId, documentId, {
        parentId: childId,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(source.gateway.sealAndUpload).toHaveBeenCalledTimes(callsBeforeMove);
  });

  it("deletes a subtree only after publishing its encrypted manifest", async () => {
    const source = harness();
    await source.mutations.createDocument(vaultId, { title: "Parent" });
    const childId = "55".repeat(16);
    await source.mutations.createDocument(vaultId, {
      id: childId,
      parentId: documentId,
      title: "Child",
    });

    await expect(
      source.mutations.deleteDocument(vaultId, documentId),
    ).resolves.toEqual({ success: true, deleted: 2 });
    expect(source.head()?.manifest.documents).toEqual([]);
    expect(source.uploads.at(-1)).toMatchObject({
      objectId: thirdManifestId,
      contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
    });
    expect(source.index.deleteDocument).toHaveBeenCalledTimes(2);
  });

  it("restores history as a new immutable revision", async () => {
    const source = harness();
    await source.mutations.createDocument(vaultId, {
      title: "First",
      content: "One",
    });
    await source.mutations.updateDocument(vaultId, documentId, {
      title: "Second",
      content: "Two",
    });

    await expect(
      source.mutations.restoreDocumentVersion(
        vaultId,
        documentId,
        "5".repeat(64),
      ),
    ).resolves.toMatchObject({ title: "First", content: "One" });
    expect(source.uploads[4]).toMatchObject({
      objectId: documentId,
      revision: 3,
      parentRevisionIds: ["7".repeat(64)],
    });
    expect(
      decodePrivateVaultContentDocument(source.uploads[4].plaintext),
    ).toMatchObject({ title: "First", content: "One" });
  });
});
