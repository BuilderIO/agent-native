import { describe, expect, it, vi } from "vitest";

import {
  createPrivateVaultContentActionRegistry,
  PrivateVaultContentActionRegistryError,
} from "./content-action-registry.js";

const vaultId = "11".repeat(16);
const documentId = "22".repeat(16);
const otherId = "33".repeat(16);
const at = "2026-07-18T20:00:00.000Z";

function context(resource: string, operation: string) {
  return {
    jobId: "job-fixture",
    resourceId: Uint8Array.from(Buffer.from(resource, "hex")),
    operation,
  };
}

function document(content = "A moonlit path") {
  return {
    version: 1 as const,
    kind: "content-document" as const,
    id: documentId,
    parentId: null,
    title: "Secret garden",
    content,
    description: null,
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: at,
    updatedAt: at,
    visibility: "private-vault" as const,
    accessRole: "owner" as const,
    canEdit: true as const,
    canManage: true as const,
  };
}

function fixture() {
  const registry = {
    listDocuments: vi.fn(async () => ({
      manifest: { generation: 1 },
      documents: [document()],
    })),
    getDocument: vi.fn(async () => document()),
    searchDocuments: vi.fn(async () => ({ documents: [] })),
  };
  const mutations = {
    createDocument: vi.fn(async () => document()),
    updateDocument: vi.fn(async (_vault: string, _id: string, input) =>
      document(input.content ?? "A moonlit path"),
    ),
    deleteDocument: vi.fn(async () => ({ success: true as const, deleted: 1 })),
  };
  return {
    registry,
    mutations,
    actions: createPrivateVaultContentActionRegistry({
      vaultId,
      registry: registry as never,
      mutations: mutations as never,
    }),
  };
}

describe("Private Vault Content action registry", () => {
  it("preserves familiar Content read names inside the vault boundary", async () => {
    const source = fixture();
    await expect(
      source.actions["list-documents"].run(
        {},
        context(vaultId, "list-documents"),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: documentId })]);
    await expect(
      source.actions["get-document"].run(
        { id: documentId },
        context(documentId, "get-document"),
      ),
    ).resolves.toMatchObject({
      id: documentId,
      urlPath: `/page/${documentId}`,
    });
    await source.actions["search-documents"].run(
      { query: "moon" },
      context(vaultId, "search-documents"),
    );
    expect(source.registry.searchDocuments).toHaveBeenCalledWith(
      vaultId,
      "moon",
      50,
    );
  });

  it("routes create, surgical edit, move, and recursive delete locally", async () => {
    const source = fixture();
    await source.actions["create-document"].run(
      { title: "Secret garden", content: "A moonlit path" },
      context(vaultId, "create-document"),
    );
    expect(source.mutations.createDocument).toHaveBeenCalledWith(
      vaultId,
      expect.objectContaining({ title: "Secret garden" }),
    );

    await expect(
      source.actions["edit-document"].run(
        { id: documentId, find: "moonlit", replace: "starlit" },
        context(documentId, "edit-document"),
      ),
    ).resolves.toMatchObject({ applied: 1, total: 1 });
    expect(source.mutations.updateDocument).toHaveBeenCalledWith(
      vaultId,
      documentId,
      { content: "A starlit path" },
    );

    await source.actions["move-document"].run(
      { id: documentId, parentId: otherId, position: 2 },
      context(documentId, "move-document"),
    );
    expect(source.mutations.updateDocument).toHaveBeenLastCalledWith(
      vaultId,
      documentId,
      { parentId: otherId, position: 2 },
    );

    await expect(
      source.actions["delete-document"].run(
        { id: documentId },
        context(documentId, "delete-document"),
      ),
    ).resolves.toEqual({ success: true, deleted: 1 });
  });

  it("rejects cross-resource grants and unknown argument smuggling", async () => {
    const source = fixture();
    await expect(
      source.actions["get-document"].run(
        { id: documentId },
        context(otherId, "get-document"),
      ),
    ).rejects.toBeInstanceOf(PrivateVaultContentActionRegistryError);
    await expect(
      source.actions["list-documents"].run(
        { title: "leak" },
        context(vaultId, "list-documents"),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(source.registry.getDocument).not.toHaveBeenCalled();
  });
});
