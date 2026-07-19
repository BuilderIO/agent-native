import { describe, expect, it, vi } from "vitest";

import {
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
} from "./content-document-codec.js";
import { PrivateVaultContentJobActionRegistry } from "./content-job-action-registry.js";

const vaultId = "11".repeat(16);
const firstId = "22".repeat(16);
const secondId = "33".repeat(16);
const manifestId = "44".repeat(16);
const manifestRevisionId = "55".repeat(32);
const firstRevisionId = "66".repeat(32);
const secondRevisionId = "77".repeat(32);

function document(id: string, title: string, position: number) {
  return {
    version: 1 as const,
    kind: "content-document" as const,
    id,
    parentId: null,
    title,
    content: `${title} body`,
    description: null,
    icon: null,
    position,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-18T20:00:00.000Z",
    updatedAt: "2026-07-18T20:00:00.000Z",
  };
}

function harness() {
  const first = document(firstId, "First secret", 0);
  const second = {
    ...document(secondId, "Second secret", 0),
    parentId: firstId,
  };
  const manifest = {
    version: 1 as const,
    kind: "content-vault-manifest" as const,
    vaultId,
    generation: 1,
    previousManifest: null,
    documents: [
      {
        objectId: firstId,
        parentId: null,
        position: 0,
        revisions: [
          { revision: 1, revisionId: firstRevisionId, parentRevisionIds: [] },
        ],
      },
      {
        objectId: secondId,
        parentId: firstId,
        position: 0,
        revisions: [
          { revision: 1, revisionId: secondRevisionId, parentRevisionIds: [] },
        ],
      },
    ],
    committedAt: "2026-07-18T20:00:00.000Z",
  };
  const payloads = new Map([
    [manifestId, encodePrivateVaultContentManifest(manifest)],
    [firstId, encodePrivateVaultContentDocument(first)],
    [secondId, encodePrivateVaultContentDocument(second)],
  ]);
  const transport = {
    list: vi.fn(async () => [
      {
        objectId: manifestId,
        objectType: "vault-manifest" as const,
        latestRevision: { revision: 1, revisionId: manifestRevisionId },
      },
      {
        objectId: firstId,
        objectType: "document" as const,
        latestRevision: { revision: 1, revisionId: firstRevisionId },
      },
      {
        objectId: secondId,
        objectType: "document" as const,
        latestRevision: { revision: 1, revisionId: secondRevisionId },
      },
    ]),
  };
  const objects = {
    downloadAndOpen: vi.fn(async (input: { objectId: string }) => ({
      plaintext: payloads.get(input.objectId)!.slice(),
      metadata: {
        objectType:
          input.objectId === manifestId
            ? ("vault-manifest" as const)
            : ("document" as const),
        algorithmId: "anc/v1" as const,
        revision: 1,
        epoch: 1,
        parentRevisionIds: [],
        ciphertextByteLength: 100,
      },
    })),
    sealAndUpload: vi.fn(async () => ({ revisionId: "aa".repeat(32) })),
  };
  const registry = new PrivateVaultContentJobActionRegistry({
    vaultId,
    origin: "https://content.example",
    session: { fetch: vi.fn() },
    transport: transport as never,
    objects: objects as never,
  }).registry();
  return { registry, objects };
}

function context(resourceId: string, operation: string) {
  return {
    jobId: "88".repeat(16),
    jobHash: "99".repeat(32),
    resourceId: Uint8Array.from(Buffer.from(resourceId, "hex")),
    operation,
  } as never;
}

describe("Private Vault job-scoped Content actions", () => {
  it("opens only the exact document body for an object-scoped read", async () => {
    const source = harness();
    await expect(
      source.registry["get-document"]!.run(
        { id: firstId },
        context(firstId, "get-document"),
      ),
    ).resolves.toMatchObject({ id: firstId, title: "First secret" });
    expect(
      source.objects.downloadAndOpen.mock.calls.map(
        ([input]) => input.objectId,
      ),
    ).toEqual([manifestId, firstId]);
  });

  it("hydrates all bodies only for a vault-scoped list", async () => {
    const source = harness();
    await expect(
      source.registry["list-documents"]!.run(
        {},
        context(vaultId, "list-documents"),
      ),
    ).resolves.toHaveLength(2);
    expect(
      source.objects.downloadAndOpen.mock.calls.map(
        ([input]) => input.objectId,
      ),
    ).toEqual([manifestId, firstId, secondId]);
  });

  it("deletes from encrypted structure without opening descendant bodies", async () => {
    const source = harness();
    await expect(
      source.registry["delete-document"]!.run(
        { id: firstId },
        context(firstId, "delete-document"),
      ),
    ).resolves.toEqual({ success: true, deleted: 2 });
    expect(
      source.objects.downloadAndOpen.mock.calls.map(
        ([input]) => input.objectId,
      ),
    ).toEqual([manifestId]);
    expect(source.objects.sealAndUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          jobId: "88".repeat(16),
          jobHash: "99".repeat(32),
        },
        contentType: "application/vnd.agent-native.content-vault-manifest+json",
      }),
    );
  });
});
