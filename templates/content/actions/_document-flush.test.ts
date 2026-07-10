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
});
