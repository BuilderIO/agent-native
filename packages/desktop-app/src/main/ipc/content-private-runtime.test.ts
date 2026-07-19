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
    health: vi.fn(() => ({ vaultId, brokerState: "offline", broker: null })),
    documents: vi.fn(() => documents),
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
      value: { vaultId, brokerState: "offline", broker: null },
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
    expect(source.documents.getDocument).not.toHaveBeenCalled();
    expect(source.documents.createDocument).not.toHaveBeenCalled();
  });
});
