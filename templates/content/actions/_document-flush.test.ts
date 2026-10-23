import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  many: vi.fn(),
  cas: vi.fn(),
  hasCollab: vi.fn(),
  isLiveBodyWriterPage: vi.fn(),
  awareness: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: mocks.get,
  appStateGetManyEntries: mocks.many,
  appStateCompareAndSet: mocks.cas,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => {
    throw new Error("Database access is forbidden in mailbox tests");
  },
  createGetDb: () => () => {
    throw new Error("Database access is forbidden in mailbox tests");
  },
}));
vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: 0xffffffff,
  hasCollabState: mocks.hasCollab,
  loadAwarenessRowsStrict: mocks.awareness,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("./_document-save-row.js", async (original) => ({
  ...(await original<typeof import("./_document-save-row.js")>()),
  createDocumentFlushCapture: () => mocks.capture,
  readDocumentSaveRow: mocks.capture,
}));

vi.mock("../server/lib/live-body-writer.js", () => ({
  isLiveBodyWriterPage: mocks.isLiveBodyWriterPage,
}));

import {
  documentContentHash,
  documentRevisionToken,
} from "../server/lib/document-revision.js";
import {
  flushAckKey,
  type DocumentFlushRequest,
  type DocumentFlushAck,
} from "../shared/document-flush-protocol.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush";

const SQL_ROW = {
  kind: "document",
  bodyRevision: 4,
  content: "Saved body.",
  title: "Saved title",
  updatedAt: "2026-10-17T12:00:00.000Z",
  contentHash: documentContentHash("Saved body."),
};
const SAVED = {
  unsavedEdits: false,
  savedRevision: documentRevisionToken(4, SQL_ROW.content),
  savedTitle: SQL_ROW.title,
  savedTitleAt: SQL_ROW.updatedAt,
};
const UNSAVED = {
  unsavedEdits: true,
  savedRevision: null,
  savedTitle: null,
  savedTitleAt: null,
};
function editorRow(
  clientId: number,
  email = "owner@example.com",
  fields: Record<string, unknown> = {},
) {
  return {
    clientId,
    state: JSON.stringify({
      canFlushDocument: true,
      visible: true,
      user: { email },
      documentFlushProtocol: 2,
      editorSessionId: `editor-${clientId}`,
      ...fields,
    }),
    lastSeen: Date.now(),
  };
}
let store: Map<string, Record<string, any>>;
let respond: (
  request: DocumentFlushRequest,
  target: { clientId: number; editorSessionId: string },
  email: string,
) => DocumentFlushAck | null;
let requestHook:
  | ((request: DocumentFlushRequest, email: string) => void)
  | undefined;
let legacyReplies = true;
const address = (email: string, key: string) => `${email}|${key}`;
function ack(
  request: DocumentFlushRequest,
  target: { clientId: number; editorSessionId: string },
): DocumentFlushAck {
  const envelope = {
    protocol: 2 as const,
    id: request.id,
    requestId: request.requestId,
    phase: request.phase,
    phaseToken: request.phaseToken,
    ...target,
  };
  return request.phase === "prepare"
    ? {
        ...envelope,
        status: "prepared",
        stabilityToken: `stable-${target.clientId}-${request.prepareToken}`,
        claim: request.propertyId
          ? {
              kind: "property",
              propertyId: request.propertyId,
              contentHash: SQL_ROW.contentHash,
            }
          : {
              kind: "document",
              save: {
                revision: SAVED.savedRevision,
                title: SAVED.savedTitle,
                titleUpdatedAt: SAVED.savedTitleAt,
              },
            },
      }
    : {
        ...envelope,
        status: "verified",
        stabilityToken: `stable-${target.clientId}-${request.prepareToken}`,
      };
}
async function settle() {
  const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(20_001);
  return result;
}

describe("flushOpenDocumentEditorToSql", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    store = new Map();
    requestHook = undefined;
    legacyReplies = true;
    respond = (request, target) => ack(request, target);
    mocks.hasCollab.mockResolvedValue(false);
    mocks.awareness.mockResolvedValue([editorRow(123)]);
    mocks.capture.mockResolvedValue(SQL_ROW);
    mocks.isLiveBodyWriterPage.mockResolvedValue(false);
    mocks.get.mockImplementation(
      async (email, key) => store.get(address(email, key)) ?? null,
    );
    mocks.many.mockImplementation(async (email, keys: string[]) =>
      keys
        .filter((key) => store.has(address(email, key)))
        .map((key) => ({ key, value: store.get(address(email, key)) })),
    );
    mocks.cas.mockImplementation(async (email, key, expected, next) => {
      const current = store.get(address(email, key)) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next === null) store.delete(address(email, key));
      else store.set(address(email, key), next);
      if (key === "flush-request-doc-1" && next?.protocol === 2) {
        requestHook?.(next, email);
        for (const target of next.targets) {
          const answer = respond(next, target, email);
          if (answer)
            store.set(
              address(email, flushAckKey(next, target.clientId)),
              answer,
            );
        }
      } else if (key === "flush-request-doc-1" && next && !next.protocol) {
        // The pre-repair session-level protocol answers only the first session.
        if (
          legacyReplies &&
          (email === "first@example.com" || email === "owner@example.com")
        )
          store.set(address(email, key), { ...next, status: "success" });
      }
      return true;
    });
  });
  afterEach(() => vi.useRealTimers());

  it("confirms every identity through prepare, coherent capture, and a fresh verify token", async () => {
    mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
    const result = await settle();
    expect(result).toMatchObject({
      value: {
        status: "flushed",
        snapshot: SQL_ROW,
        editors: [
          { clientId: 123, editorSessionId: "editor-123", flush: "answered" },
          { clientId: 456, editorSessionId: "editor-456", flush: "answered" },
        ],
      },
    });
    const requests = mocks.cas.mock.calls
      .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
      .map((call) => call[3]);
    expect(requests.map((r) => r.phase)).toEqual(["prepare", "verify"]);
    expect(requests[0].phaseToken).not.toBe(requests[1].phaseToken);
    expect(requests[1].prepareToken).toBe(requests[0].phaseToken);
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it("returns at once for a switched page's body, whose tabs already wrote SQL", async () => {
    mocks.isLiveBodyWriterPage.mockResolvedValue(true);

    expect(await settle()).toEqual({ value: { status: "live_copy" } });
    expect(mocks.isLiveBodyWriterPage).toHaveBeenCalledWith("doc-1");
    expect(mocks.cas).not.toHaveBeenCalled();
  });

  it("reads no page write path when no editor is open", async () => {
    mocks.awareness.mockResolvedValue([]);

    expect(await settle()).toEqual({ value: { status: "no_open_editor" } });
    expect(mocks.isLiveBodyWriterPage).not.toHaveBeenCalled();
  });

  it("still asks a switched page's editor to save a Blocks field", async () => {
    mocks.isLiveBodyWriterPage.mockResolvedValue(true);
    mocks.capture.mockResolvedValue({
      ...SQL_ROW,
      kind: "property",
      propertyId: "notes",
    });

    await expect(
      flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        propertyId: "notes",
      }),
    ).resolves.toHaveProperty("snapshot.propertyId", "notes");
    const requests = mocks.cas.mock.calls
      .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
      .map((call) => call[3]);
    expect(requests[0]).toMatchObject({ propertyId: "notes" });
  });

  it.each([undefined, "notes"])(
    "accepts identity-specific preparation after a twelve-second hosted poll (%s)",
    async (propertyId) => {
      if (propertyId)
        mocks.capture.mockResolvedValue({
          ...SQL_ROW,
          kind: "property",
          propertyId,
        });
      const started = Date.now();
      respond = (request, target) =>
        request.phase === "verify" ? ack(request, target) : null;
      requestHook = (request, email) => {
        if (request.phase === "prepare")
          setTimeout(() => {
            for (const target of request.targets)
              store.set(
                address(email, flushAckKey(request, target.clientId)),
                ack(request, target),
              );
          }, 12_000);
      };
      const result = flushOpenDocumentEditorToSql({
        documentId: "doc-1",
        propertyId,
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(12_200);
      expect(await result).toHaveProperty("value.status", "flushed");
      const requests = mocks.cas.mock.calls
        .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
        .map((call) => call[3]);
      expect(requests.map((request) => request.phase)).toEqual([
        "prepare",
        "verify",
      ]);
      expect(
        requests.every((request) => request.expiresAt === started + 20_000),
      ).toBe(true);
      expect(mocks.capture).toHaveBeenCalledOnce();
    },
  );

  it("waits for a same-email identity's twelve-second verify response", async () => {
    mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
    respond = (request, target) =>
      request.phase === "verify" && target.clientId === 456
        ? null
        : ack(request, target);
    requestHook = (request, email) => {
      if (request.phase === "verify")
        setTimeout(() => {
          const target = request.targets.find(
            (target) => target.clientId === 456,
          )!;
          store.set(
            address(email, flushAckKey(request, target.clientId)),
            ack(request, target),
          );
        }, 12_000);
    };
    const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(11_800);
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(store.size).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toHaveProperty("value.editors.length", 2);
  });

  it("shares the twenty-second bound across prepare, capture, and verify", async () => {
    respond = () => null;
    requestHook = (request, email) => {
      setTimeout(() => {
        for (const target of request.targets)
          store.set(
            address(email, flushAckKey(request, target.clientId)),
            ack(request, target),
          );
      }, 12_000);
    };
    const started = Date.now();
    const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await result).toMatchObject({
      error: {
        errorCode: "open_editor_flush_timeout",
        details: { phase: "verify" },
      },
    });
    expect(Date.now() - started).toBe(20_001);
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("keeps an unexpired twenty-second mailbox occupied after twelve seconds", async () => {
    const occupied = {
      requestId: "earlier",
      expiresAt: Date.now() + 20_000,
      status: "success",
    };
    store.set(address("owner@example.com", "flush-request-doc-1"), occupied);
    const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(12_200);
    expect(mocks.cas).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(7_801);
    expect(await result).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(
      store.get(address("owner@example.com", "flush-request-doc-1")),
    ).toEqual(occupied);
  });

  it("replaces an expired mailbox by CAS and freshly confirms its own identities", async () => {
    const occupied = {
      requestId: "expired",
      expiresAt: Date.now() - 1,
      status: "success",
    };
    store.set(address("owner@example.com", "flush-request-doc-1"), occupied);
    expect(await settle()).toHaveProperty("value.status", "flushed");
    expect(mocks.cas).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      occupied,
      expect.objectContaining({ protocol: 2, phase: "prepare" }),
      { requestSource: "agent" },
    );
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it.each(["success", "error"] as const)(
    "replaces an expired terminal legacy mailbox (%s) before a fresh handshake",
    async (status) => {
      const occupied = {
        id: "doc-1",
        requestId: "legacy-request",
        ts: Date.now() - 20_001,
        status,
      };
      store.set(address("owner@example.com", "flush-request-doc-1"), occupied);
      expect(await settle()).toMatchObject({
        value: {
          status: "flushed",
          snapshot: SQL_ROW,
          editors: [{ clientId: 123, flush: "answered" }],
        },
      });
      expect(mocks.cas).toHaveBeenCalledWith(
        "owner@example.com",
        "flush-request-doc-1",
        occupied,
        expect.objectContaining({ protocol: 2, phase: "prepare" }),
        { requestSource: "agent" },
      );
      const requests = mocks.cas.mock.calls
        .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
        .map(([, , , next]) => next);
      expect(requests.map((request) => request.phase)).toEqual([
        "prepare",
        "verify",
      ]);
      expect(requests[0].requestId).not.toBe(occupied.requestId);
      expect(requests[1].phaseToken).not.toBe(requests[0].phaseToken);
      expect(mocks.capture).toHaveBeenCalledOnce();
      expect(store.size).toBe(0);
    },
  );

  it.each(["success", "error", "pending"] as const)(
    "does not steal an unexpired or unfinished legacy mailbox (%s)",
    async (status) => {
      const occupied = {
        requestId: "legacy-request",
        ts: Date.now() - (status === "pending" ? 20_001 : 0),
        status,
      };
      store.set(address("owner@example.com", "flush-request-doc-1"), occupied);
      const reading = flushOpenDocumentEditorToSql({
        documentId: "doc-1",
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(12_200);
      expect(mocks.cas).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(7_801);
      expect(await reading).toHaveProperty(
        "error.errorCode",
        "open_editor_flush_timeout",
      );
      expect(
        store.get(address("owner@example.com", "flush-request-doc-1")),
      ).toBe(occupied);
    },
  );

  it("preserves a fresh successor when replacement of an expired legacy mailbox loses CAS", async () => {
    const occupied = {
      requestId: "legacy",
      ts: Date.now() - 20_001,
      status: "success",
    };
    const successor = {
      requestId: "successor",
      ts: Date.now(),
      status: "pending",
    };
    const key = address("owner@example.com", "flush-request-doc-1");
    store.set(key, occupied);
    const compare = mocks.cas.getMockImplementation()!;
    mocks.cas.mockImplementation(
      async (email, mailbox, expected, next, options) => {
        if (expected === occupied) store.set(key, successor);
        return compare(email, mailbox, expected, next, options);
      },
    );
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(mocks.cas).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      occupied,
      expect.objectContaining({ protocol: 2, phase: "prepare" }),
      { requestSource: "agent" },
    );
    expect(store.get(key)).toBe(successor);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("times out when one required editor session remains unconfirmed", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "first@example.com", UNSAVED),
      editorRow(456, "second@example.com", UNSAVED),
    ]);
    respond = (request, target) =>
      target.clientId === 123 ? ack(request, target) : null;
    expect(await settle()).toMatchObject({
      error: {
        errorCode: "open_editor_flush_timeout",
        details: {
          phase: "prepare",
          waitingEditors: [{ clientId: 456, editorSessionId: "editor-456" }],
        },
      },
    });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("refuses a same-email dirty tab whose response is held beside an answering clean tab", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", SAVED),
      editorRow(456, "owner@example.com", UNSAVED),
    ]);
    respond = (request, target) =>
      target.clientId === 123 ? ack(request, target) : null;
    expect(await settle()).toMatchObject({
      error: { errorCode: "open_editor_flush_timeout" },
    });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("freshly challenges even a matching old saved claim while dirty awareness and saving are held", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", SAVED),
    ]);
    respond = () => null;
    expect(await settle()).toMatchObject({
      error: { errorCode: "open_editor_flush_timeout" },
    });
    expect(mocks.cas).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      null,
      expect.objectContaining({
        protocol: 2,
        phase: "prepare",
        targets: [{ clientId: 123, editorSessionId: "editor-123" }],
      }),
      { requestSource: "agent" },
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each(["requestId", "phaseToken", "clientId", "editorSessionId", "phase"])(
    "refuses a wrong %s acknowledgment",
    async (field) => {
      respond = (request, target) =>
        ({ ...ack(request, target), [field]: "unrelated" }) as DocumentFlushAck;
      expect(await settle()).toMatchObject({
        error: { errorCode: "open_editor_flush_invalid_ack" },
      });
    },
  );

  it("does not accept a terminal session mailbox as any client's acknowledgment", async () => {
    respond = () => null;
    requestHook = (request, email) =>
      store.set(address(email, "flush-request-doc-1"), {
        ...request,
        status: "success",
      });
    expect(await settle()).toMatchObject({
      error: { errorCode: "open_editor_flush_timeout" },
    });
  });

  it("retries preparation after an edit between prepare and post-capture verification", async () => {
    let changed = false;
    respond = (request, target) => {
      if (request.phase === "verify" && !changed) {
        changed = true;
        return { ...ack(request, target), status: "changed" };
      }
      return ack(request, target);
    };
    expect(await settle()).toMatchObject({
      value: { status: "flushed", snapshot: SQL_ROW },
    });
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });

  it("waits out the original deadline when every post-capture verification changes", async () => {
    respond = (request, target) =>
      request.phase === "verify"
        ? { ...ack(request, target), status: "changed" }
        : ack(request, target);
    expect(await settle()).toMatchObject({
      error: { errorCode: "open_editor_flush_timeout" },
    });
    expect(mocks.capture.mock.calls.length).toBeGreaterThan(3);
  });

  it.each(["prepare", "verify"] as const)(
    "retries transient editor error ACKs in %s until a typing burst settles inside the original deadline",
    async (phase) => {
      const started = Date.now();
      mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
      respond = (request, target) =>
        request.phase === phase &&
        target.clientId === 123 &&
        Date.now() < started + 1_600
          ? {
              ...ack(request, target),
              status: "error",
              errorCode: "editor_flush_failed",
            }
          : ack(request, target);
      const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1_400);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(await result).toMatchObject({
        value: {
          status: "flushed",
          snapshot: SQL_ROW,
          editors: [
            { clientId: 123, flush: "answered" },
            { clientId: 456, flush: "answered" },
          ],
        },
      });
      const requests = mocks.cas.mock.calls
        .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
        .map((call) => call[3]);
      const prepares = requests.filter(
        (request) => request.phase === "prepare",
      );
      expect(prepares.length).toBeGreaterThan(3);
      expect(new Set(requests.map((request) => request.phaseToken)).size).toBe(
        requests.length,
      );
      expect(
        requests.every(
          (request) =>
            request.expiresAt === started + 20_000 &&
            request.targets.length === 2,
        ),
      ).toBe(true);
      expect(prepares.length).toBeLessThanOrEqual(10);
      const winning = requests[requests.length - 1];
      expect(winning.phase).toBe("verify");
      expect(winning.prepareToken).toBe(
        prepares[prepares.length - 1].prepareToken,
      );
      expect(store.size).toBe(0);
    },
  );

  it("retains an editor error diagnostic but refuses only at the original deadline during continuous typing", async () => {
    const started = Date.now();
    respond = (request, target) => ({
      ...ack(request, target),
      status: "error",
      errorCode: "editor_save_unacknowledged",
    });
    let outcome: any;
    void flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => {
        outcome = { value };
      },
      (error) => {
        outcome = { error };
      },
    );
    await vi.advanceTimersByTimeAsync(19_999);
    expect(outcome).toBeUndefined();
    expect(mocks.capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({
      error: {
        errorCode: "open_editor_flush_timeout",
        details: {
          lastEditorError: {
            clientId: 123,
            errorCode: "editor_save_unacknowledged",
          },
        },
      },
    });
    expect(Date.now() - started).toBe(20_000);
    const prepares = mocks.cas.mock.calls
      .filter(
        ([, key, , next]) =>
          key === "flush-request-doc-1" && next?.phase === "prepare",
      )
      .map((call) => call[3]);
    expect(prepares.length).toBeGreaterThan(3);
    expect(prepares.length).toBeLessThanOrEqual(100);
    expect(
      prepares.every((request) => request.expiresAt === started + 20_000),
    ).toBe(true);
  });

  it("does not let a previous nonce's success or a missing sibling settle a retried attempt", async () => {
    mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
    let first: DocumentFlushRequest | undefined;
    respond = (request, target) => {
      first ??= request;
      if (request.phaseToken === first.phaseToken)
        return {
          ...ack(request, target),
          status: "error",
          errorCode: "editor_flush_failed",
        };
      return target.clientId === 123 ? ack(first, target) : null;
    };
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_invalid_ack",
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("requires a fresh answer from a missing same-email sibling after an editor error retry", async () => {
    mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
    let first: string | undefined;
    respond = (request, target) => {
      first ??= request.phaseToken;
      if (request.phaseToken === first)
        return target.clientId === 123
          ? {
              ...ack(request, target),
              status: "error",
              errorCode: "editor_flush_failed",
            }
          : ack(request, target);
      return target.clientId === 123 ? ack(request, target) : null;
    };
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    const requests = mocks.cas.mock.calls
      .filter(([, key, , next]) => key === "flush-request-doc-1" && next)
      .map((call) => call[3]);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.targets.length === 2)).toBe(
      true,
    );
    expect(requests[1].phaseToken).not.toBe(requests[0].phaseToken);
  });

  it("does not load full bodies on the 200ms ticker while a peer is held", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", {
        ...SAVED,
        savedRevision: documentRevisionToken(5, "not in SQL yet"),
      }),
      editorRow(456, "owner@example.com", {
        ...SAVED,
        savedRevision: documentRevisionToken(5, "not in SQL yet"),
      }),
    ]);
    legacyReplies = false;
    respond = (request, target) =>
      target.clientId === 123 ? ack(request, target) : null;
    const result = await settle();
    expect(result).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.many.mock.calls.length).toBeGreaterThan(15);
  });

  it("uses one shared S for every prepared claim", async () => {
    mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
    respond = (request, target) => {
      const value = ack(request, target);
      return target.clientId === 456 && value.status === "prepared"
        ? {
            ...value,
            claim: {
              kind: "document",
              save: {
                revision: documentRevisionToken(5, "not in SQL"),
                title: SQL_ROW.title,
                titleUpdatedAt: SQL_ROW.updatedAt,
              },
            },
          }
        : value;
    };
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(mocks.capture.mock.calls.length).toBeGreaterThan(3);
  });

  it("preserves a successor mailbox when cleanup loses its CAS race", async () => {
    const successor = {
      requestId: "successor",
      expiresAt: Date.now() + 10_000,
    };
    const original = mocks.cas.getMockImplementation()!;
    mocks.cas.mockImplementation(
      async (email, key, expected, next, options) => {
        if (key === "flush-request-doc-1" && next === null)
          store.set(address(email, key), successor);
        return original(email, key, expected, next, options);
      },
    );
    expect(await settle()).toHaveProperty("value.status", "flushed");
    expect(
      store.get(address("owner@example.com", "flush-request-doc-1")),
    ).toEqual(successor);
  });

  it.each(["throw", "held"] as const)(
    "preserves a verified snapshot when cleanup is %s",
    async (mode) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const compare = mocks.cas.getMockImplementation()!;
      let release!: () => void;
      mocks.cas.mockImplementation(
        async (email, key, expected, next, options) => {
          if (key === "flush-request-doc-1" && next === null) {
            if (mode === "throw") throw new Error("cleanup refused");
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return compare(email, key, expected, next, options);
        },
      );
      const result = await settle();
      expect(result).toMatchObject({
        value: { status: "flushed", snapshot: SQL_ROW },
      });
      if (mode === "held") {
        release();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(warning).toHaveBeenCalled();
      warning.mockRestore();
    },
  );

  it.each(["throw", "held"] as const)(
    "retains the original typed protocol failure when cleanup is %s",
    async (mode) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      respond = (request, target) => ({
        ...ack(request, target),
        phaseToken: "wrong-phase",
      });
      const compare = mocks.cas.getMockImplementation()!;
      let release!: () => void;
      mocks.cas.mockImplementation(
        async (email, key, expected, next, options) => {
          if (key === "flush-request-doc-1" && next === null) {
            if (mode === "throw") throw new Error("cleanup refused");
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return compare(email, key, expected, next, options);
        },
      );
      expect(await settle()).toHaveProperty(
        "error.errorCode",
        "open_editor_flush_invalid_ack",
      );
      if (mode === "held") {
        release();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(warning).toHaveBeenCalled();
      warning.mockRestore();
    },
  );

  it("bounds mailbox acquisition and preparation by the same twenty-second deadline", async () => {
    store.set(address("owner@example.com", "flush-request-doc-1"), {
      requestId: "occupied",
      expiresAt: Date.now() + 12_000,
    });
    respond = () => null;
    const started = Date.now();
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(Date.now() - started).toBe(20_001);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("never promotes a refused phase CAS into success", async () => {
    const original = mocks.cas.getMockImplementation()!;
    mocks.cas.mockImplementation(async (email, key, expected, next, options) =>
      next?.phase === "verify"
        ? false
        : original(email, key, expected, next, options),
    );
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_contention",
    );
  });

  it.each(["awareness", "many", "capture"])(
    "returns a typed failure for unreadable %s",
    async (method) => {
      mocks[method as "awareness" | "many" | "capture"].mockRejectedValue(
        new Error("storage unavailable"),
      );
      expect(await settle()).toHaveProperty(
        "error.errorCode",
        "open_editor_flush_unreadable",
      );
    },
  );

  it.each([{ editorSessionId: null }, { user: {} }])(
    "refuses an unidentified known required writer %j",
    async (fields) => {
      mocks.awareness.mockResolvedValue([
        editorRow(123, "owner@example.com", fields),
      ]);
      expect(await settle()).toHaveProperty(
        "error.errorCode",
        "open_editor_unidentified",
      );
    },
  );

  it.each(["{invalid", "null", "[]", "42", '"presence"'])(
    "skips an unrelated malformed awareness row %s while freshly confirming the required writer",
    async (state) => {
      mocks.awareness.mockResolvedValue([
        { clientId: 99, state, lastSeen: Date.now() },
        editorRow(123),
      ]);
      expect(await settle()).toMatchObject({
        value: {
          status: "flushed",
          snapshot: SQL_ROW,
          editors: [
            { clientId: 123, editorSessionId: "editor-123", flush: "answered" },
          ],
        },
      });
    },
  );

  it("refuses an unsupported known writer beside a legacy viewer", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", { documentFlushProtocol: 1 }),
      editorRow(456, "legacy@example.com", {
        canFlushDocument: undefined,
        documentFlushProtocol: undefined,
        editorSessionId: undefined,
      }),
    ]);
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_unsupported",
    );
  });

  it("does not drop a known writer when its awareness hides or disappears", async () => {
    mocks.awareness
      .mockResolvedValueOnce([
        editorRow(123, "owner@example.com", { visible: false }),
      ])
      .mockResolvedValue([]);
    respond = () => null;
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(mocks.awareness).toHaveBeenCalledOnce();
  });

  it("keeps new editors outside the original request cohort", async () => {
    mocks.awareness
      .mockResolvedValueOnce([editorRow(123)])
      .mockResolvedValue([editorRow(123), editorRow(456)]);
    expect(await settle()).toHaveProperty("value.editors.length", 1);
    expect(mocks.awareness).toHaveBeenCalledOnce();
  });

  it("retains the original captured snapshot when SQL changes after capture", async () => {
    requestHook = (request) => {
      if (request.phase === "verify")
        mocks.capture.mockResolvedValue({
          ...SQL_ROW,
          content: "later unrelated body",
        });
    };
    expect(await settle()).toHaveProperty(
      "value.snapshot.content",
      SQL_ROW.content,
    );
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("confirms exactly one additional Blocks field against its captured property value", async () => {
    mocks.capture.mockResolvedValue({
      ...SQL_ROW,
      kind: "property",
      propertyId: "notes",
    });
    const result = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await expect(result).resolves.toHaveProperty(
      "snapshot.propertyId",
      "notes",
    );
    expect(mocks.capture).toHaveBeenCalledWith("doc-1", "notes");
  });

  it("does not substitute a primary-body claim for an additional field", async () => {
    mocks.capture.mockResolvedValue({
      ...SQL_ROW,
      kind: "property",
      propertyId: "notes",
    });
    respond = (request, target) =>
      ack({ ...request, propertyId: undefined }, target);
    const result = flushOpenDocumentEditorToSql({
      documentId: "doc-1",
      propertyId: "notes",
    });
    await expect(result).rejects.toHaveProperty(
      "errorCode",
      "open_editor_flush_invalid_ack",
    );
  });

  it.each([false, true])(
    "preserves exact additional-field ambiguity rules (legacy=%s)",
    async (legacy) => {
      mocks.awareness.mockResolvedValue(
        legacy
          ? [
              editorRow(123, "owner@example.com", {
                canFlushDocument: undefined,
              }),
            ]
          : [editorRow(123), editorRow(456)],
      );
      await expect(
        flushOpenDocumentEditorToSql({
          documentId: "doc-1",
          propertyId: "notes",
        }),
      ).rejects.toHaveProperty("errorCode", "open_editor_field_ambiguous");
    },
  );

  it("uses no-open-editor for viewers and never treats them as writers", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", { canFlushDocument: false }),
    ]);
    expect(await settle()).toEqual({ value: { status: "no_open_editor" } });
  });

  it("reports legacy-only presence as explicitly unconfirmed", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", { canFlushDocument: undefined }),
    ]);
    expect(await settle()).toEqual({
      value: {
        status: "flushed",
        editors: [
          { clientId: 123, flush: "unconfirmed", reason: "legacy_editor" },
        ],
      },
    });
  });
  it("asks a legacy editor using main's best-effort mailbox wait without claiming a fresh receipt", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", { canFlushDocument: undefined }),
    ]);
    legacyReplies = false;
    const started = Date.now();
    let complete = false;
    const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => {
        complete = true;
        return value;
      },
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.cas).toHaveBeenCalledWith(
      "owner@example.com",
      "flush-request-doc-1",
      null,
      expect.objectContaining({ id: "doc-1", status: "pending", ts: started }),
      { requestSource: "agent" },
    );
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(3_800);
    expect(await result).toEqual({
      status: "flushed",
      editors: [
        { clientId: 123, flush: "unconfirmed", reason: "legacy_editor" },
      ],
    });
    expect(Date.now() - started).toBe(4_000);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("keeps a legacy error acknowledgment typed instead of reporting unconfirmed success", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "owner@example.com", { canFlushDocument: undefined }),
    ]);
    legacyReplies = false;
    const compare = mocks.cas.getMockImplementation()!;
    mocks.cas.mockImplementation(
      async (email, key, expected, next, options) => {
        const changed = await compare(email, key, expected, next, options);
        if (changed && next?.status === "pending")
          store.set(address(email, key), {
            ...next,
            status: "error",
            error: "Legacy write failed",
          });
        return changed;
      },
    );
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_failed",
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("joins legacy mailbox acquisitions before returning an unconfirmed sibling read failure", async () => {
    mocks.awareness.mockResolvedValue([
      editorRow(123, "first@example.com", { canFlushDocument: undefined }),
      editorRow(456, "second@example.com", { canFlushDocument: undefined }),
    ]);
    const read = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((email, key) =>
      email === "second@example.com"
        ? Promise.reject(new Error("legacy mailbox read failed"))
        : read(email, key),
    );
    const compare = mocks.cas.getMockImplementation()!;
    let release!: () => void;
    mocks.cas.mockImplementation(
      async (email, key, expected, next, options) => {
        if (email === "first@example.com" && next?.status === "pending")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return compare(email, key, expected, next, options);
      },
    );
    let complete = false;
    const result = flushOpenDocumentEditorToSql({ documentId: "doc-1" }).then(
      (value) => {
        complete = true;
        return { value };
      },
      (error) => {
        complete = true;
        return { error };
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(200);
      expect(complete).toBe(false);
    } finally {
      release();
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({
      value: {
        status: "flushed",
        editors: [
          { clientId: 123, flush: "unconfirmed", reason: "legacy_editor" },
          { clientId: 456, flush: "unconfirmed", reason: "legacy_editor" },
        ],
      },
    });
    expect(store.size).toBe(0);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each(["acquisition-read", "write", "answer-read"])(
    "keeps a legacy per-session %s failure unconfirmed while joining a healthy sibling",
    async (operation) => {
      mocks.awareness.mockResolvedValue([
        editorRow(123, "first@example.com", { canFlushDocument: undefined }),
        editorRow(456, "owner@example.com", { canFlushDocument: undefined }),
      ]);
      const read = mocks.get.getMockImplementation()!;
      const compare = mocks.cas.getMockImplementation()!;
      let failed = false;
      mocks.get.mockImplementation(async (email, key) => {
        if (
          email === "first@example.com" &&
          (operation === "acquisition-read" ||
            (operation === "answer-read" &&
              !failed &&
              store.has(address(email, key))))
        ) {
          failed = true;
          throw new Error("legacy session read unavailable");
        }
        return read(email, key);
      });
      mocks.cas.mockImplementation(
        async (email, key, expected, next, options) => {
          if (email === "first@example.com" && operation === "write" && next) {
            failed = true;
            throw new Error("legacy session write unavailable");
          }
          return compare(email, key, expected, next, options);
        },
      );
      expect(await settle()).toMatchObject({
        value: {
          status: "flushed",
          editors: [
            { clientId: 123, flush: "unconfirmed", reason: "legacy_editor" },
            { clientId: 456, flush: "unconfirmed", reason: "legacy_editor" },
          ],
        },
      });
      expect(failed).toBe(true);
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    },
  );

  it.each(["get", "cas"] as const)(
    "keeps legacy-only presence unconfirmed when every %s operation rejects",
    async (operation) => {
      mocks.awareness.mockResolvedValue([
        editorRow(123, "owner@example.com", { canFlushDocument: undefined }),
      ]);
      mocks[operation].mockRejectedValue(
        new Error("legacy mailbox unavailable"),
      );
      expect(await settle()).toEqual({
        value: {
          status: "flushed",
          editors: [
            { clientId: 123, flush: "unconfirmed", reason: "legacy_editor" },
          ],
        },
      });
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  it.each(["get", "cas"] as const)(
    "keeps a required modern mailbox %s failure typed",
    async (operation) => {
      mocks[operation].mockRejectedValue(
        new Error("required mailbox unavailable"),
      );
      expect(await settle()).toHaveProperty(
        "error.errorCode",
        "open_editor_flush_unreadable",
      );
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  describe.each(["prepare", "verify"] as const)(
    "ACK batch validation during %s",
    (phase) => {
      it.each(["error", "changed"] as const)(
        "validates every present sibling before retrying %s",
        async (status) => {
          for (const retryFirst of [true, false]) {
            for (const invalid of [
              "nonce",
              "claim",
              "value",
              "error-code",
            ] as const) {
              mocks.awareness.mockResolvedValue([
                editorRow(123),
                editorRow(456),
              ]);
              let firstToken: string | undefined;
              respond = (request, target) => {
                if (request.phase !== phase) return ack(request, target);
                firstToken ??= request.phaseToken;
                if (request.phaseToken !== firstToken)
                  return ack(request, target);
                if (target.clientId === (retryFirst ? 123 : 456))
                  return {
                    ...ack(request, target),
                    status,
                    errorCode: "editor_flush_failed",
                  } as DocumentFlushAck;
                if (invalid === "value")
                  return 42 as unknown as DocumentFlushAck;
                if (invalid === "error-code")
                  return {
                    ...ack(request, target),
                    status: "error",
                    errorCode: undefined,
                  } as unknown as DocumentFlushAck;
                return invalid === "nonce"
                  ? { ...ack(request, target), phaseToken: "unrelated-nonce" }
                  : ({
                      ...ack(request, target),
                      status: "prepared",
                      claim: {},
                    } as DocumentFlushAck);
              };
              const result = await settle();
              expect(result).toHaveProperty(
                "error.errorCode",
                "open_editor_flush_invalid_ack",
              );
            }
          }
        },
      );

      it.each(["error", "changed"] as const)(
        "retries a valid %s without waiting for a missing sibling's old nonce",
        async (status) => {
          for (const sibling of ["missing", "valid"] as const) {
            mocks.awareness.mockResolvedValue([editorRow(123), editorRow(456)]);
            let firstToken: string | undefined;
            respond = (request, target) => {
              if (request.phase !== phase) return ack(request, target);
              firstToken ??= request.phaseToken;
              if (request.phaseToken !== firstToken)
                return ack(request, target);
              if (target.clientId === 123)
                return {
                  ...ack(request, target),
                  status,
                  errorCode: "editor_flush_failed",
                } as DocumentFlushAck;
              return sibling === "missing" ? null : ack(request, target);
            };
            const result = await settle();
            expect(result).toHaveProperty("value.status", "flushed");
            expect(result).toHaveProperty("value.editors", [
              expect.objectContaining({ clientId: 123, flush: "answered" }),
              expect.objectContaining({ clientId: 456, flush: "answered" }),
            ]);
          }
        },
      );
    },
  );
});
