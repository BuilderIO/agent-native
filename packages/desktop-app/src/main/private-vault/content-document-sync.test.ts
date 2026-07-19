import { describe, expect, it, vi } from "vitest";

import {
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  type PrivateVaultContentDocument,
  type PrivateVaultContentManifest,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import {
  PrivateVaultContentSync,
  PrivateVaultContentSyncError,
} from "./content-document-sync.js";

const vaultId = "11".repeat(16);
const documentId = "22".repeat(16);
const documentRevisionId = "33".repeat(32);
const firstManifestId = "44".repeat(16);
const firstManifestRevisionId = "55".repeat(32);
const secondManifestId = "66".repeat(16);
const secondManifestRevisionId = "77".repeat(32);

const document: PrivateVaultContentDocument = {
  version: 1,
  kind: "content-document",
  id: documentId,
  parentId: null,
  title: "Only the devices learn this",
  content: "A private body",
  description: null,
  icon: null,
  position: 0,
  isFavorite: false,
  hideFromSearch: false,
  createdAt: "2026-07-18T20:00:00.000Z",
  updatedAt: "2026-07-18T20:00:00.000Z",
};

function manifest(
  generation: number,
  previousManifest: PrivateVaultContentManifest["previousManifest"],
): PrivateVaultContentManifest {
  return {
    version: 1,
    kind: "content-vault-manifest",
    vaultId,
    generation,
    previousManifest,
    documents: [
      {
        objectId: documentId,
        revisions: [
          {
            revision: 1,
            revisionId: documentRevisionId,
            parentRevisionIds: [],
          },
        ],
      },
    ],
    committedAt: `2026-07-18T2${generation}:00:00.000Z`,
  };
}

function harness(local: PrivateVaultLocalManifestHead | null = null) {
  const first = manifest(1, null);
  const second = manifest(2, {
    objectId: firstManifestId,
    revisionId: firstManifestRevisionId,
  });
  const objects = [
    {
      objectId: firstManifestId,
      objectType: "vault-manifest" as const,
      latestRevision: { revision: 1, revisionId: firstManifestRevisionId },
    },
    {
      objectId: secondManifestId,
      objectType: "vault-manifest" as const,
      latestRevision: { revision: 1, revisionId: secondManifestRevisionId },
    },
    {
      objectId: documentId,
      objectType: "document" as const,
      latestRevision: { revision: 1, revisionId: documentRevisionId },
    },
  ];
  const payloads = new Map<
    string,
    {
      contentType:
        | typeof PRIVATE_VAULT_CONTENT_TYPE
        | typeof PRIVATE_VAULT_MANIFEST_CONTENT_TYPE;
      plaintext: Uint8Array;
    }
  >([
    [
      `${firstManifestId}:${firstManifestRevisionId}`,
      {
        contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
        plaintext: encodePrivateVaultContentManifest(first),
      },
    ],
    [
      `${secondManifestId}:${secondManifestRevisionId}`,
      {
        contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
        plaintext: encodePrivateVaultContentManifest(second),
      },
    ],
    [
      `${documentId}:${documentRevisionId}`,
      {
        contentType: PRIVATE_VAULT_CONTENT_TYPE,
        plaintext: encodePrivateVaultContentDocument(document),
      },
    ],
  ]);
  let stored = local;
  const gateway = {
    list: vi.fn(async () => objects),
    open: vi.fn(async (input: { objectId: string; revisionId: string }) => {
      const value = payloads.get(`${input.objectId}:${input.revisionId}`)!;
      return { ...value, plaintext: value.plaintext.slice() };
    }),
  };
  const index = {
    readManifest: vi.fn(async () => stored),
    writeDocument: vi.fn(async () => undefined),
    writeManifest: vi.fn(async (head: PrivateVaultLocalManifestHead) => {
      stored = head;
    }),
  };
  return { gateway, index, first, second, stored: () => stored };
}

describe("PrivateVaultContentSync", () => {
  it("reconstructs the newest verified manifest and document cache", async () => {
    const source = harness();
    const result = await new PrivateVaultContentSync(source).synchronize(
      vaultId,
    );
    expect(result).toMatchObject({
      objectId: secondManifestId,
      revisionId: secondManifestRevisionId,
      manifest: { generation: 2 },
    });
    expect(source.index.writeDocument).toHaveBeenCalledWith(
      vaultId,
      documentRevisionId,
      document,
    );
    expect(source.stored()).toEqual(result);
  });

  it("detects a withheld local head and a same-generation fork", async () => {
    const newerLocal: PrivateVaultLocalManifestHead = {
      version: 1,
      objectId: "88".repeat(16),
      revisionId: "99".repeat(32),
      manifest: { ...manifest(3, null), previousManifest: null },
    };
    const withheld = harness(newerLocal);
    await expect(
      new PrivateVaultContentSync(withheld).synchronize(vaultId),
    ).rejects.toBeInstanceOf(PrivateVaultContentSyncError);

    const forked = harness();
    forked.gateway.list.mockResolvedValueOnce([
      ...(await forked.gateway.list()),
      {
        objectId: "aa".repeat(16),
        objectType: "vault-manifest",
        latestRevision: { revision: 1, revisionId: "bb".repeat(32) },
      },
    ] as never);
    const openNormally = forked.gateway.open.getMockImplementation()!;
    forked.gateway.open.mockImplementation(async (input) => {
      if (input.objectId === "aa".repeat(16))
        return {
          contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
          plaintext: Uint8Array.from(
            encodePrivateVaultContentManifest(forked.second),
          ),
        };
      return openNormally(input);
    });
    await expect(
      new PrivateVaultContentSync(forked).synchronize(vaultId),
    ).rejects.toBeInstanceOf(PrivateVaultContentSyncError);
  });

  it("does not advance the manifest when document hydration fails", async () => {
    const source = harness();
    const openNormally = source.gateway.open.getMockImplementation()!;
    source.gateway.open.mockImplementationOnce(openNormally);
    source.gateway.open.mockImplementationOnce(openNormally);
    source.gateway.open.mockRejectedValueOnce(new Error("offline"));
    await expect(
      new PrivateVaultContentSync(source).synchronize(vaultId),
    ).rejects.toThrow("offline");
    expect(source.index.writeManifest).not.toHaveBeenCalled();
  });
});
