import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateDelete: vi.fn(),
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
  getRequestUserEmail: vi.fn(),
  hasCollabState: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateDelete: mocks.appStateDelete,
  appStateGet: mocks.appStateGet,
  appStatePut: mocks.appStatePut,
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: 0xffffffff,
  hasCollabState: mocks.hasCollabState,
  loadAwarenessRowsStrict: mocks.loadAwarenessRowsStrict,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import { flushOpenDocumentEditorToSql } from "./_document-flush";

describe("flushOpenDocumentEditorToSql", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 123,
        state: JSON.stringify({
          canFlushDocument: true,
          visible: true,
          user: { email: "owner@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
    mocks.appStatePut.mockResolvedValue(undefined);
    mocks.appStateDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes after an open editor acknowledges the flush", async () => {
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toBeUndefined();
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
  });

  it("fails closed when the live editor reports a save error", async () => {
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "error",
      error: "The document changed while preparing it for sync.",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    const rejected = expect(flush).rejects.toThrow(
      "The document changed while preparing it for sync.",
    );
    await vi.advanceTimersByTimeAsync(200);

    await rejected;
    expect(mocks.appStateDelete).toHaveBeenCalled();
  });

  it("fails closed when no active editor acknowledges before timeout", async () => {
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    const rejected = expect(flush).rejects.toThrow(/did not finish saving/i);
    await vi.advanceTimersByTimeAsync(4_200);

    await rejected;
  });

  it("fails closed when the flush request cannot be written", async () => {
    mocks.appStatePut.mockRejectedValue(new Error("connection unavailable"));

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).rejects.toThrow(/could not ask the open document editor/i);
  });

  it("fails closed when active-editor awareness cannot be read", async () => {
    mocks.loadAwarenessRowsStrict.mockRejectedValue(
      new Error("awareness storage unavailable"),
    );

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).rejects.toThrow("awareness storage unavailable");
    expect(mocks.appStatePut).not.toHaveBeenCalled();
  });

  it("skips the handshake when only persisted Yjs state remains", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([]);

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.appStatePut).not.toHaveBeenCalled();
  });

  it("uses SQL immediately when the only active collaborators are modern read-only viewers", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 123,
        state: JSON.stringify({
          canFlushDocument: false,
          visible: true,
          user: { email: "viewer@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.appStatePut).not.toHaveBeenCalled();
    expect(mocks.appStateGet).not.toHaveBeenCalled();
  });

  it("accepts an acknowledgement from a legacy editor without a capability field", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toBeUndefined();
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "legacy-editor@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
  });

  it("honors an explicit save error from a legacy editor", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "error",
      error: "Legacy editor could not serialize the live document.",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    const rejected = expect(flush).rejects.toThrow(
      "Legacy editor could not serialize the live document.",
    );
    await vi.advanceTimersByTimeAsync(200);

    await rejected;
  });

  it("falls back to SQL after a legacy-only editor handshake stays silent", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy-viewer-or-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(4_200);

    await expect(flush).resolves.toBeUndefined();
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "legacy-viewer-or-editor@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
    expect(mocks.appStateDelete).toHaveBeenCalled();
  });

  it("falls back to SQL when a legacy-only flush request cannot be written", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStatePut.mockRejectedValue(new Error("connection unavailable"));

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toBeUndefined();
  });

  it("still waits when an edit-capable collaborator is present beside viewers", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 123,
        state: JSON.stringify({
          canFlushDocument: false,
          visible: true,
          user: { email: "viewer@example.com" },
        }),
        lastSeen: Date.now(),
      },
      {
        clientId: 456,
        state: JSON.stringify({
          canFlushDocument: true,
          visible: true,
          user: { email: "shared-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toBeUndefined();
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "shared-editor@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
  });

  it("still fails closed when a modern editor is silent beside a legacy tab", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 123,
        state: JSON.stringify({
          canFlushDocument: true,
          visible: true,
          user: { email: "modern-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy-viewer-or-editor@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    const rejected = expect(flush).rejects.toThrow(/did not finish saving/i);
    await vi.advanceTimersByTimeAsync(4_200);

    await rejected;
  });
});
