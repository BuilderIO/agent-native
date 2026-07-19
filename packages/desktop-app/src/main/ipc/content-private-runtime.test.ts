import { describe, expect, it, vi } from "vitest";

import { createContentPrivateRuntimeIpcHandlers } from "./content-private-runtime.js";

const vaultId = "11".repeat(16);
const documentId = "22".repeat(16);

function fixture(allowed = true) {
  const documents = {
    listDocuments: vi.fn(async () => ({ documents: [] })),
    getDocument: vi.fn(async () => ({ id: documentId })),
    searchDocuments: vi.fn(async () => ({ documents: [] })),
    createDocument: vi.fn(async () => ({ id: documentId })),
    updateDocument: vi.fn(async () => ({ id: documentId })),
    deleteDocument: vi.fn(async () => ({ success: true })),
    listDocumentVersions: vi.fn(async () => ({ versions: [] })),
    restoreDocumentVersion: vi.fn(async () => ({ id: documentId })),
  };
  const runtime = {
    ensureStarted: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    health: vi.fn(() => ({ brokerState: "offline", broker: null })),
    activeVaultId: vi.fn(() => vaultId),
    documents: vi.fn(() => documents),
    listAgentGrants: vi.fn(async () => ({ grants: [] })),
    listVaultMembers: vi.fn(async () => ({ members: [] })),
    revokeAgentGrant: vi.fn(async (grantRef: string) => ({
      state: "revoked",
      grantRef,
    })),
    listLegacyMigrationCandidates: vi.fn(async () => ["legacy-document"]),
    migrateLegacyContent: vi.fn(async () => ({ state: "cutover" })),
    exportLegacyMigration: vi.fn(async () => ({ exportId: "55".repeat(16) })),
    setApplicationState: vi.fn(),
  };
  return {
    documents,
    runtime,
    handlers: createContentPrivateRuntimeIpcHandlers({
      runtimeForEvent: () => (allowed ? (runtime as never) : null),
    }),
  };
}

describe("signed Private Content IPC", () => {
  it("starts and routes bounded CRUD without accepting vault coordinates", async () => {
    const source = fixture();
    const event = {} as never;
    await expect(source.handlers.start(event)).resolves.toEqual({
      ok: true,
      value: { brokerState: "offline", broker: null },
    });
    await source.handlers.create(event, {
      title: "Private title",
      content: "Private body",
    });
    await source.handlers.get(event, documentId);
    await source.handlers.search(event, { query: "private", limit: 20 });
    await source.handlers.update(event, {
      id: documentId,
      title: "Revised",
    });
    await source.handlers.delete(event, documentId);
    await source.handlers.listVersions(event, documentId);
    await source.handlers.restoreVersion(event, {
      id: documentId,
      revisionId: "33".repeat(32),
    });
    await source.handlers.listGrants(event);
    await source.handlers.listMembers(event);
    await source.handlers.revokeGrant(event, "44".repeat(32));
    await source.handlers.migrationCandidates(event);
    await source.handlers.migrate(event, {
      mode: "start",
      sourceDocumentIds: ["legacy-document"],
    });
    await source.handlers.exportMigration(event, {
      migrationId: "55".repeat(16),
    });
    await source.handlers.setApplicationState(event, {
      view: "editor",
      documentId,
    });

    expect(source.documents.createDocument).toHaveBeenCalledWith(
      vaultId,
      expect.objectContaining({ title: "Private title" }),
    );
    expect(source.documents.getDocument).toHaveBeenCalledWith(
      vaultId,
      documentId,
    );
    expect(source.documents.searchDocuments).toHaveBeenCalledWith(
      vaultId,
      "private",
      20,
    );
    expect(source.documents.listDocumentVersions).toHaveBeenCalledWith(
      vaultId,
      documentId,
    );
    expect(source.documents.restoreDocumentVersion).toHaveBeenCalledWith(
      vaultId,
      documentId,
      "33".repeat(32),
    );
    expect(source.runtime.listAgentGrants).toHaveBeenCalledOnce();
    expect(source.runtime.listVaultMembers).toHaveBeenCalledOnce();
    expect(source.runtime.revokeAgentGrant).toHaveBeenCalledWith(
      "44".repeat(32),
    );
    expect(source.runtime.listLegacyMigrationCandidates).toHaveBeenCalledOnce();
    expect(source.runtime.migrateLegacyContent).toHaveBeenCalledWith({
      sourceDocumentIds: ["legacy-document"],
    });
    expect(source.runtime.exportLegacyMigration).toHaveBeenCalledWith(
      "55".repeat(16),
    );
    expect(source.runtime.setApplicationState).toHaveBeenCalledWith({
      view: "editor",
      documentId,
    });
  });

  it("collapses untrusted senders and malformed arguments", async () => {
    const denied = fixture(false);
    await expect(denied.handlers.list({} as never)).resolves.toEqual({
      ok: false,
      error: "Private Content is locked or unavailable.",
    });
    const source = fixture();
    await expect(
      source.handlers.get({} as never, "not-an-object-id"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.create({} as never, {
        title: "Valid",
        smuggled: "no",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.restoreVersion({} as never, {
        id: documentId,
        revisionId: "not-a-revision",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.revokeGrant({} as never, "not-a-grant-ref"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.migrate({} as never, {
        mode: "start",
        sourceDocumentIds: [],
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.exportMigration({} as never, {
        migrationId: "not-a-migration",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      source.handlers.setApplicationState({} as never, {
        view: "editor",
        documentId,
        title: "must not enter application state",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(source.documents.getDocument).not.toHaveBeenCalled();
    expect(source.documents.createDocument).not.toHaveBeenCalled();
    expect(source.runtime.revokeAgentGrant).not.toHaveBeenCalled();
    expect(source.runtime.setApplicationState).not.toHaveBeenCalled();
  });
});
