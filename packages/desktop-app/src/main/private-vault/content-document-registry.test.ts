import { describe, expect, it } from "vitest";

import type {
  PrivateVaultContentDocument,
  PrivateVaultContentManifest,
} from "./content-document-codec.js";
import {
  PrivateVaultContentRegistry,
  PrivateVaultContentRegistryError,
} from "./content-document-registry.js";

const vaultId = "11".repeat(16);
const firstId = "22".repeat(16);
const secondId = "33".repeat(16);

function fixture() {
  const documents = new Map<string, PrivateVaultContentDocument>([
    [
      firstId,
      {
        version: 1,
        kind: "content-document",
        id: firstId,
        parentId: null,
        title: "Secret garden",
        content: "The moonlit path begins here.",
        description: null,
        icon: null,
        position: 1,
        isFavorite: true,
        hideFromSearch: false,
        createdAt: "2026-07-18T20:00:00.000Z",
        updatedAt: "2026-07-18T20:00:00.000Z",
      },
    ],
    [
      secondId,
      {
        version: 1,
        kind: "content-document",
        id: secondId,
        parentId: firstId,
        title: "Hidden root",
        content: "moonlit but deliberately hidden",
        description: "child",
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: true,
        createdAt: "2026-07-18T20:00:00.000Z",
        updatedAt: "2026-07-18T21:00:00.000Z",
      },
    ],
  ]);
  const manifest: PrivateVaultContentManifest = {
    version: 1,
    kind: "content-vault-manifest",
    vaultId,
    generation: 1,
    previousManifest: null,
    documents: [...documents].map(([objectId], index) => ({
      objectId,
      revisions: [
        {
          revision: 1,
          revisionId: String(index + 4).repeat(64),
          parentRevisionIds: [],
        },
      ],
    })),
    committedAt: "2026-07-18T21:00:00.000Z",
  };
  return {
    manifest,
    documents,
    index: {
      readManifest: async () => ({
        version: 1 as const,
        objectId: "66".repeat(16),
        revisionId: "77".repeat(32),
        manifest,
      }),
      readDocument: async (
        _vaultId: string,
        objectId: string,
        _revisionId: string,
      ) => documents.get(objectId) ?? null,
    },
  };
}

describe("PrivateVaultContentRegistry", () => {
  it("lists only decrypted local metadata in stable tree order", async () => {
    const source = fixture();
    const result = await new PrivateVaultContentRegistry(
      source.index,
    ).listDocuments(vaultId);
    expect(result.documents.map((document) => document.id)).toEqual([
      secondId,
      firstId,
    ]);
    expect(result.documents[1]).toMatchObject({
      title: "Secret garden",
      contentPreview: "The moonlit path begins here.",
      visibility: "private-vault",
      accessRole: "owner",
    });
  });

  it("returns a full document through the familiar local read contract", async () => {
    const source = fixture();
    await expect(
      new PrivateVaultContentRegistry(source.index).getDocument(
        vaultId,
        firstId,
      ),
    ).resolves.toMatchObject({
      id: firstId,
      title: "Secret garden",
      content: "The moonlit path begins here.",
      canEdit: true,
    });
  });

  it("searches plaintext locally and honors hide-from-search", async () => {
    const source = fixture();
    const result = await new PrivateVaultContentRegistry(
      source.index,
    ).searchDocuments(vaultId, "moonlit");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      id: firstId,
      snippet: "The moonlit path begins here.",
    });
  });

  it("lists immutable encrypted revisions newest first", async () => {
    const source = fixture();
    source.manifest.documents[0].revisions.push({
      revision: 2,
      revisionId: "77".repeat(32),
      parentRevisionIds: [source.manifest.documents[0].revisions[0].revisionId],
    });
    const result = await new PrivateVaultContentRegistry(
      source.index,
    ).listDocumentVersions(vaultId, firstId);
    expect(result.versions.map((version) => version.revision)).toEqual([2, 1]);
    expect(result.versions[0]).toMatchObject({
      documentId: firstId,
      title: "Secret garden",
    });
  });

  it("fails closed for a missing cache entry or invalid tree", async () => {
    const source = fixture();
    source.documents.delete(secondId);
    await expect(
      new PrivateVaultContentRegistry(source.index).listDocuments(vaultId),
    ).rejects.toBeInstanceOf(PrivateVaultContentRegistryError);

    const cyclic = fixture();
    cyclic.documents.set(firstId, {
      ...cyclic.documents.get(firstId)!,
      parentId: secondId,
    });
    await expect(
      new PrivateVaultContentRegistry(cyclic.index).listDocuments(vaultId),
    ).rejects.toBeInstanceOf(PrivateVaultContentRegistryError);
  });
});
