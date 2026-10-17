import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateCompareAndSet: vi.fn(),
  appStateDelete: vi.fn(),
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
  getRequestUserEmail: vi.fn(),
  hasCollabState: vi.fn(),
  isLiveBodyWriterPage: vi.fn(),
  liveBodyWriterPageIds: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
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

vi.mock("../server/lib/live-body-writer.js", () => ({
  isLiveBodyWriterPage: mocks.isLiveBodyWriterPage,
  liveBodyWriterPageIds: mocks.liveBodyWriterPageIds,
}));

import {
  flushOpenDocumentEditorToSql,
  saveOpenEditorTitles,
} from "./_document-flush";

describe("flushOpenDocumentEditorToSql", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.isLiveBodyWriterPage.mockResolvedValue(false);
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

  describe("on a switched page, whose tabs already wrote its body", () => {
    const titleEditor = (
      email: string,
      extra: Record<string, unknown> = {},
    ) => ({
      clientId: 200 + mocks.loadAwarenessRowsStrict.mock.calls.length,
      state: JSON.stringify({
        canFlushDocument: true,
        canFlushTitle: true,
        visible: true,
        user: { email },
        ...extra,
      }),
      lastSeen: Date.now(),
    });
    const sentRequest = () => mocks.appStatePut.mock.calls[0]?.[2];
    const answerWith = (answer: Record<string, unknown>) =>
      mocks.appStateGet.mockImplementation(async () => ({
        ...sentRequest(),
        ...answer,
      }));
    const refusal = async (flush: Promise<unknown>) => {
      const settled = flush.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(4_400);
      return settled;
    };

    beforeEach(() => {
      mocks.isLiveBodyWriterPage.mockResolvedValue(true);
    });

    it("asks an editor that advertises the title flush for its title alone", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      answerWith({ status: "success", scope: "title", saved: true });

      const flush = flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      });
      await vi.advanceTimersByTimeAsync(200);

      await expect(flush).resolves.toEqual({ status: "flushed" });
      expect(mocks.appStatePut).toHaveBeenCalledTimes(1);
      expect(mocks.appStatePut).toHaveBeenCalledWith(
        "owner@example.com",
        "flush-request-doc-1",
        {
          id: "doc-1",
          ts: expect.any(Number),
          requestId: expect.any(String),
          scope: "title",
          status: "pending",
        },
        { requestSource: "agent" },
      );
      expect(mocks.appStateDelete).toHaveBeenCalledWith(
        "owner@example.com",
        "flush-request-doc-1",
        { requestSource: "agent" },
      );
    });

    it("asks only sessions with an editor row, not the page's owner or the caller", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("teammate@example.com"),
      ]);
      answerWith({ status: "success", scope: "title", saved: false });

      const flush = flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        ownerEmail: "owner@example.com",
      });
      await vi.advanceTimersByTimeAsync(200);

      await expect(flush).resolves.toEqual({ status: "flushed" });
      expect(mocks.appStatePut.mock.calls.map(([session]) => session)).toEqual([
        "teammate@example.com",
      ]);
    });

    it("answers no_open_editor without a request when no editor is open", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("hidden@example.com", { visible: false }),
        titleEditor("viewer@example.com", {
          canFlushDocument: false,
          canFlushTitle: false,
        }),
        { clientId: 0xffffffff, state: "{}", lastSeen: Date.now() },
      ]);

      await expect(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      ).resolves.toEqual({ status: "no_open_editor" });
      expect(mocks.appStatePut).not.toHaveBeenCalled();
    });

    it("goes ahead unconfirmed, and asks no session, when an editor doesn't advertise the title flush", async () => {
      await expect(
        flushOpenDocumentEditorToSql({
          documentId: "doc-1",
          ownerEmail: "owner@example.com",
        }),
      ).resolves.toEqual({
        status: "unconfirmed",
        reason: "legacy_editor",
        documentIds: ["doc-1"],
      });
      expect(mocks.appStatePut).not.toHaveBeenCalled();
    });

    it("asks no session that has a tab too old for the title flush, and still asks the others", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
        {
          clientId: 9,
          state: JSON.stringify({
            canFlushDocument: true,
            visible: true,
            user: { email: "owner@example.com" },
          }),
          lastSeen: Date.now(),
        },
        titleEditor("teammate@example.com"),
      ]);
      answerWith({ status: "success", scope: "title", saved: true });

      const flush = flushOpenDocumentEditorToSql({ documentId: "doc-1" });
      await vi.advanceTimersByTimeAsync(200);

      await expect(flush).resolves.toEqual({
        status: "unconfirmed",
        reason: "legacy_editor",
        documentIds: ["doc-1"],
      });
      expect(mocks.appStatePut.mock.calls.map(([session]) => session)).toEqual([
        "teammate@example.com",
      ]);
    });

    it("refuses with a typed, retryable code when no editor acknowledges in time", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      mocks.appStateGet.mockImplementation(async () => sentRequest());

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        statusCode: 409,
        details: { documentId: "doc-1", reason: "timeout", retryable: true },
      });
      expect(mocks.appStateDelete).toHaveBeenCalledWith(
        "owner@example.com",
        "flush-request-doc-1",
        { requestSource: "agent" },
      );
    });

    it("refuses with the editor's code when it couldn't save the title", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      answerWith({
        status: "error",
        scope: "title",
        code: "title_conflict",
        error: "The title changed in another tab.",
      });

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: {
          documentId: "doc-1",
          reason: "editor_error",
          code: "title_conflict",
          error: "The title changed in another tab.",
          retryable: true,
        },
      });
    });

    it("refuses when it can't put the request in an editor's mailbox", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      mocks.appStateCompareAndSet.mockResolvedValue(false);
      mocks.appStateGet.mockResolvedValue({
        id: "doc-1",
        requestId: "someone-else",
        status: "pending",
        ts: Date.now(),
      });

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "request_not_delivered", retryable: true },
      });
    });

    it("refuses when an editor advertises the title flush without a session to ask", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([titleEditor(" ")]);

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "request_not_delivered" },
      });
      expect(mocks.appStatePut).not.toHaveBeenCalled();
    });

    it("refuses when an editor advertises the title flush with no user at all", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        {
          clientId: 301,
          state: JSON.stringify({
            canFlushDocument: true,
            canFlushTitle: true,
            visible: true,
          }),
          lastSeen: Date.now(),
        },
      ]);

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "request_not_delivered" },
      });
      expect(mocks.appStatePut).not.toHaveBeenCalled();
    });

    it("refuses when an editor without a session to ask sits beside an old tab without one either", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor(" "),
        {
          clientId: 300,
          state: JSON.stringify({
            canFlushDocument: true,
            visible: true,
            user: {},
          }),
          lastSeen: Date.now(),
        },
      ]);

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "request_not_delivered" },
      });
      expect(mocks.appStatePut).not.toHaveBeenCalled();
    });

    it("takes back the request it delivered, and refuses typed, when another session's mailbox can't be read", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("a@example.com"),
        titleEditor("b@example.com"),
      ]);
      mocks.appStateCompareAndSet.mockImplementation(
        async (session: string, _key: string, _expected: unknown, next) =>
          session === "a@example.com" || next === null,
      );
      mocks.appStateGet.mockImplementation(async (session: string) => {
        if (session === "b@example.com") throw new Error("mailbox unreadable");
        return sentRequest();
      });

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "request_not_delivered", retryable: true },
      });
      expect(mocks.appStateDelete).toHaveBeenCalledWith(
        "a@example.com",
        "flush-request-doc-1",
        { requestSource: "agent" },
      );
      expect(logged).toHaveBeenCalledWith(
        "Failed to ask an open editor to save a page title",
        expect.objectContaining({ documentId: "doc-1" }),
      );
      logged.mockRestore();
      warned.mockRestore();
    });

    it("refuses typed, not as a timeout, when it can't read an editor's answer before its deadline", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      mocks.appStateGet.mockRejectedValue(new Error("mailbox unreadable"));

      const error = await refusal(
        flushOpenDocumentEditorToSql({ documentId: "doc-1" }),
      );

      expect(error).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: {
          documentId: "doc-1",
          reason: "acknowledgement_unreadable",
          retryable: true,
        },
      });
      expect(logged).toHaveBeenCalledWith(
        "Failed to read an open editor's answer about a page title",
        expect.objectContaining({ documentId: "doc-1" }),
      );
      logged.mockRestore();
      warned.mockRestore();
    });

    it("keeps waiting through a mailbox read that fails once, and takes the answer after it", async () => {
      mocks.loadAwarenessRowsStrict.mockResolvedValue([
        titleEditor("owner@example.com"),
      ]);
      mocks.appStateGet
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockImplementation(async () => ({
          ...sentRequest(),
          status: "success",
          scope: "title",
          saved: true,
        }));

      const flush = flushOpenDocumentEditorToSql({ documentId: "doc-1" });
      await vi.advanceTimersByTimeAsync(400);

      await expect(flush).resolves.toEqual({ status: "flushed" });
    });

    it("gives up on a silent editor at its deadline, not a poll interval after it", async () => {
      mocks.loadAwarenessRowsStrict.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve([titleEditor("owner@example.com")]),
              3_900,
            ),
          ),
      );
      mocks.appStateGet.mockImplementation(async () => sentRequest());
      let settled: unknown;
      void flushOpenDocumentEditorToSql({ documentId: "doc-1" }).catch(
        (error: unknown) => {
          settled = error;
        },
      );

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toMatchObject({
        errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
        details: { reason: "timeout" },
      });
    });

    it("answers by its deadline when it can't read every page's open editors in time", async () => {
      const ids = Array.from({ length: 50 }, (_, index) => `page-${index}`);
      mocks.liveBodyWriterPageIds.mockResolvedValue(new Set(ids));
      mocks.loadAwarenessRowsStrict.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 1_000)),
      );
      let settled: unknown;
      void saveOpenEditorTitles(ids).then((flush) => {
        settled = flush;
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toEqual({
        status: "failed",
        reason: "timeout",
        documentId: "page-40",
      });
    });
  });

  it("still asks a switched page's editor to save a Blocks field", async () => {
    mocks.isLiveBodyWriterPage.mockResolvedValue(true);
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

    await expect(flush).resolves.toBeUndefined();
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      expect.objectContaining({ propertyId: "notes" }),
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

    await expect(flush).resolves.toBeUndefined();
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

    await expect(flush).resolves.toBeUndefined();
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

    await expect(flush).resolves.toBeUndefined();
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
