import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  many: vi.fn(),
  cas: vi.fn(),
  hasCollab: vi.fn(),
  awareness: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: mocks.get,
  appStateGetManyEntries: mocks.many,
  appStateCompareAndSet: mocks.cas,
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
  await vi.advanceTimersByTimeAsync(4_001);
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
    mocks.hasCollab.mockResolvedValue(true);
    mocks.awareness.mockResolvedValue([editorRow(123)]);
    mocks.capture.mockResolvedValue(SQL_ROW);
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

  it("refuses continuous edits after the explicit capture attempt cap", async () => {
    respond = (request, target) =>
      request.phase === "verify"
        ? { ...ack(request, target), status: "changed" }
        : ack(request, target);
    expect(await settle()).toMatchObject({
      error: { errorCode: "open_editor_flush_contention" },
    });
    expect(mocks.capture).toHaveBeenCalledTimes(3);
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
      "open_editor_flush_contention",
    );
    expect(mocks.capture).toHaveBeenCalledTimes(3);
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

  it("bounds mailbox acquisition and preparation by the same four-second deadline", async () => {
    store.set(address("owner@example.com", "flush-request-doc-1"), {
      requestId: "occupied",
      expiresAt: Date.now() + 3_000,
    });
    respond = () => null;
    const started = Date.now();
    expect(await settle()).toHaveProperty(
      "error.errorCode",
      "open_editor_flush_timeout",
    );
    expect(Date.now() - started).toBe(4_001);
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
});
