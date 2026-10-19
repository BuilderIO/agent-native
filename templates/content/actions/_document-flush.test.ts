import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateCompareAndSet: vi.fn(),
  appStateDelete: vi.fn(),
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
  getRequestUserEmail: vi.fn(),
  hasCollabState: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
  readDocumentSaveRow: vi.fn(),
  editorSaveIsInSql: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateCompareAndSet: async (
    session: string,
    key: string,
    expected: unknown,
    next: unknown,
    options: unknown,
  ) => {
    if (expected === null && next !== null) {
      await mocks.appStatePut(session, key, next, options);
    } else if (next === null) {
      await mocks.appStateDelete(session, key, options);
    }
    return mocks.appStateCompareAndSet(session, key, expected, next, options);
  },
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

vi.mock("./_document-save-row.js", () => ({
  readDocumentSaveRow: mocks.readDocumentSaveRow,
  editorSaveIsInSql: mocks.editorSaveIsInSql,
}));

import { flushOpenDocumentEditorToSql } from "./_document-flush";

const SQL_ROW = {
  bodyRevision: 4,
  content: "Saved body.",
  title: "Saved title",
  updatedAt: "2026-10-17T12:00:00.000Z",
};

function editorRow(
  clientId: number,
  email: string,
  fields: Record<string, unknown> = {},
) {
  return {
    clientId,
    state: JSON.stringify({
      canFlushDocument: true,
      visible: true,
      user: { email },
      ...fields,
    }),
    lastSeen: Date.now(),
  };
}

const SAVED = {
  unsavedEdits: false,
  savedRevision: "body:4:sha256:" + "a".repeat(64),
  savedTitle: "Saved title",
  savedTitleAt: "2026-10-17T12:00:00.000Z",
};

const UNSAVED = {
  unsavedEdits: true,
  savedRevision: null,
  savedTitle: null,
  savedTitleAt: null,
};

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
    mocks.appStateCompareAndSet.mockResolvedValue(true);
    mocks.appStateDelete.mockResolvedValue(undefined);
    mocks.readDocumentSaveRow.mockResolvedValue(SQL_ROW);
    mocks.editorSaveIsInSql.mockReturnValue(true);
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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
  });

  it("targets one exact additional Blocks field", async () => {
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.appStatePut).toHaveBeenCalledTimes(1);
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ propertyId: "notes" }),
      { requestSource: "agent" },
    );
  });

  it("waits for an occupied document flush mailbox before writing", async () => {
    mocks.appStateCompareAndSet
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.appStateGet
      .mockResolvedValueOnce({
        id: "doc-1",
        requestId: "another-request",
        status: "pending",
      })
      .mockImplementation(async () => ({
        id: "doc-1",
        requestId: mocks.appStatePut.mock.calls.at(-1)?.[2]?.requestId,
        status: "success",
      }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.appStateCompareAndSet).toHaveBeenCalledTimes(3);
  });

  it("reclaims a stale terminal acknowledgement before writing", async () => {
    const stale = {
      id: "doc-1",
      requestId: "timed-out-request",
      status: "success",
      ts: Date.now() - 4_001,
    };
    mocks.appStateCompareAndSet
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    mocks.appStateGet
      .mockResolvedValueOnce(stale)
      .mockImplementation(async () => ({
        id: "doc-1",
        requestId: mocks.appStatePut.mock.calls.at(-1)?.[2]?.requestId,
        status: "success",
      }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.appStateCompareAndSet).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      stale,
      null,
      { requestSource: "agent" },
    );
  });

  it("does not reclaim a concurrent request's fresh acknowledgement", async () => {
    const fresh = {
      id: "doc-1",
      requestId: "concurrent-request",
      status: "success",
      ts: Date.now(),
    };
    mocks.appStateCompareAndSet.mockResolvedValue(false);
    mocks.appStateGet.mockResolvedValue(fresh);

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    const rejected = expect(flush).rejects.toThrow(
      /could not ask the open document editor/i,
    );
    await vi.advanceTimersByTimeAsync(4_200);

    await rejected;
    expect(mocks.appStateCompareAndSet).not.toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      fresh,
      null,
      { requestSource: "agent" },
    );
  });

  it("fails an exact-field read when multiple editors are open", async () => {
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
      {
        clientId: 456,
        state: JSON.stringify({
          canFlushDocument: true,
          visible: true,
          user: { email: "collaborator@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        propertyId: "notes",
      }),
    ).rejects.toThrow(/exact fresh Blocks field value/i);
    expect(mocks.appStatePut).not.toHaveBeenCalled();
  });

  it("fails an exact-field read when only a legacy editor is identifiable", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 456,
        state: JSON.stringify({
          visible: true,
          user: { email: "legacy@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        propertyId: "notes",
      }),
    ).rejects.toThrow(/exact fresh Blocks field value/i);
    expect(mocks.appStatePut).not.toHaveBeenCalled();
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
    ).resolves.toEqual({ status: "no_open_editor" });

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
    ).resolves.toEqual({ status: "no_open_editor" });

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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 456, flush: "answered" }],
    });
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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [
        { clientId: 456, flush: "unconfirmed", reason: "legacy_editor" },
      ],
    });
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
    ).resolves.toEqual({
      status: "flushed",
      editors: [
        { clientId: 456, flush: "unconfirmed", reason: "legacy_editor" },
      ],
    });
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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 456, flush: "answered" }],
    });
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
  it("skips an editor whose reported save is already in SQL", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      editorRow(123, "owner@example.com", SAVED),
    ]);

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "skipped_saved" }],
    });
    expect(mocks.readDocumentSaveRow).toHaveBeenCalledWith("doc-1");
    expect(mocks.editorSaveIsInSql).toHaveBeenCalledWith(SQL_ROW, {
      revision: SAVED.savedRevision,
      title: SAVED.savedTitle,
      titleUpdatedAt: SAVED.savedTitleAt,
    });
    expect(mocks.appStatePut).not.toHaveBeenCalled();
  });

  it("asks an editor whose reported save SQL has not reached", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      editorRow(123, "owner@example.com", SAVED),
    ]);
    mocks.editorSaveIsInSql.mockReturnValue(false);
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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
  });

  it("accepts the save an asked editor reports while the request waits", async () => {
    mocks.loadAwarenessRowsStrict
      .mockResolvedValueOnce([editorRow(123, "owner@example.com", UNSAVED)])
      .mockResolvedValue([editorRow(123, "owner@example.com", SAVED)]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "reported_saved" }],
    });
    expect(mocks.appStatePut).toHaveBeenCalled();
    expect(mocks.readDocumentSaveRow).toHaveBeenCalledTimes(1);
    expect(mocks.appStateDelete).toHaveBeenCalled();
  });

  it.each([false, true])(
    "does not retain a saved report after new edits (initially saved: %s)",
    async (initiallySaved) => {
      mocks.loadAwarenessRowsStrict
        .mockResolvedValueOnce([
          editorRow(123, "first@example.com", initiallySaved ? SAVED : UNSAVED),
          editorRow(456, "second@example.com", UNSAVED),
        ])
        .mockResolvedValueOnce([
          editorRow(123, "first@example.com", SAVED),
          editorRow(456, "second@example.com", UNSAVED),
        ])
        .mockResolvedValue([
          editorRow(123, "first@example.com", UNSAVED),
          editorRow(456, "second@example.com", SAVED),
        ]);
      mocks.appStateGet.mockResolvedValue(null);

      const flush = flushOpenDocumentEditorToSql({ documentId: "doc-1" });
      const outcome = flush.then(
        (result) => ({ status: "resolved", result }),
        (error: unknown) => ({ status: "rejected", error }),
      );
      await vi.advanceTimersByTimeAsync(4_200);

      expect(await outcome).toMatchObject({
        status: "rejected",
        error: {
          errorCode: "open_editor_flush_timeout",
          details: { documentId: "doc-1", waitingEditors: [123, 456] },
        },
      });
      expect(mocks.loadAwarenessRowsStrict.mock.calls.length).toBeGreaterThan(
        3,
      );
    },
  );

  it("times out with a typed failure while a reported save stays out of SQL", async () => {
    mocks.loadAwarenessRowsStrict
      .mockResolvedValueOnce([editorRow(123, "owner@example.com", UNSAVED)])
      .mockResolvedValue([editorRow(123, "owner@example.com", SAVED)]);
    mocks.editorSaveIsInSql.mockReturnValue(false);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    const rejected = expect(flush).rejects.toMatchObject({
      errorCode: "open_editor_flush_timeout",
      details: { documentId: "doc-1", waitingEditors: [123] },
    });
    await vi.advanceTimersByTimeAsync(4_200);

    await rejected;
  });

  it("does not trust a reported save for an exact Blocks field", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      editorRow(123, "owner@example.com", SAVED),
    ]);
    mocks.appStateGet.mockImplementation(async () => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [{ clientId: 123, flush: "answered" }],
    });
    expect(mocks.readDocumentSaveRow).not.toHaveBeenCalled();
  });

  it("asks only the sessions of editors that still have to save", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      editorRow(123, "saved@example.com", SAVED),
      editorRow(456, "typing@example.com", UNSAVED),
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

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [
        { clientId: 123, flush: "skipped_saved" },
        { clientId: 456, flush: "answered" },
      ],
    });
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "typing@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ id: "doc-1" }),
      { requestSource: "agent" },
    );
    expect(mocks.appStatePut).not.toHaveBeenCalledWith(
      "saved@example.com",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("labels an editor whose session did not answer before another did", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      editorRow(123, "first@example.com", UNSAVED),
      editorRow(456, "second@example.com", UNSAVED),
    ]);
    mocks.appStateGet.mockImplementation(async (session: string) => ({
      id: "doc-1",
      requestId: mocks.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: session === "first@example.com" ? "success" : "pending",
    }));

    const flush = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(flush).resolves.toEqual({
      status: "flushed",
      editors: [
        { clientId: 123, flush: "answered" },
        {
          clientId: 456,
          flush: "unconfirmed",
          reason: "another_session_answered",
        },
      ],
    });
  });
});
