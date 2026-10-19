import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordChange = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());
const mockCreateEventStream = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockResolveSlidesRequestAuth = vi.hoisted(() => vi.fn());
const streamState = vi.hoisted(() => ({
  sent: [] as string[],
  onClosed: [] as Array<() => void>,
}));

vi.mock("h3", () => ({
  createEventStream: (...args: unknown[]) => mockCreateEventStream(...args),
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server/poll", () => ({
  recordChange: (...args: unknown[]) => mockRecordChange(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) =>
    mockResolveSlidesRequestAuth(...args),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => mockWhere(...args),
      }),
    }),
  }),
  schema: {
    decks: {
      id: "id",
      ownerEmail: "owner_email",
      orgId: "org_id",
      visibility: "visibility",
    },
  },
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { deckEvents, notifyClients } from "./decks";

async function connectClient(email: string, orgId?: string) {
  mockResolveSlidesRequestAuth.mockResolvedValueOnce({
    ok: true,
    context: { email, ...(orgId ? { orgId } : {}) },
  });
  await (deckEvents as (event: unknown) => Promise<unknown>)({});
}

describe("notifyClients", () => {
  beforeEach(() => {
    mockRecordChange.mockClear();
    mockWhere.mockReset();
    mockCreateEventStream.mockReset();
    mockResolveAccess.mockReset();
    mockResolveSlidesRequestAuth.mockReset();
    streamState.sent.length = 0;
    streamState.onClosed.length = 0;
    mockCreateEventStream.mockImplementation(() => ({
      push: vi.fn((data: string) => {
        streamState.sent.push(data);
        return Promise.resolve();
      }),
      onClosed: vi.fn((callback: () => void) => {
        streamState.onClosed.push(callback);
      }),
      send: vi.fn().mockResolvedValue(undefined),
    }));
    mockResolveAccess.mockResolvedValue({ role: "viewer" });
  });

  afterEach(() => {
    for (const close of streamState.onClosed) close();
  });

  it("resolves the deck's owner/org scope from the row when the caller doesn't supply one", async () => {
    mockWhere.mockResolvedValue([
      { ownerEmail: "owner@example.com", orgId: "org-1", visibility: "org" },
    ]);

    await notifyClients("deck-1", { slideId: "slide-1", actor: "agent" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-changed",
      key: "deck-1",
      resourceType: "deck",
      resourceId: "deck-1",
      owner: "owner@example.com",
      orgId: "org-1",
      slideId: "slide-1",
      actor: "agent",
      deckId: "deck-1",
    });
  });

  it("omits orgId/visibility fields the row doesn't carry", async () => {
    mockWhere.mockResolvedValue([
      { ownerEmail: "solo@example.com", orgId: null, visibility: "private" },
    ]);

    await notifyClients("deck-2", { slideId: "slide-1", actor: "agent" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-changed",
      key: "deck-2",
      resourceType: "deck",
      resourceId: "deck-2",
      owner: "solo@example.com",
      slideId: "slide-1",
      actor: "agent",
      deckId: "deck-2",
    });
  });

  it("fails closed when the deck row lookup fails", async () => {
    mockWhere.mockRejectedValue(new Error("db unavailable"));
    await connectClient("viewer@example.com", "org-1");
    streamState.sent.length = 0;

    await notifyClients("deck-3", { actor: "agent" });

    expect(mockRecordChange).not.toHaveBeenCalled();
    expect(streamState.sent).toEqual([]);
  });

  it("fails closed when the deck row is gone", async () => {
    mockWhere.mockResolvedValue([]);
    await connectClient("viewer@example.com", "org-1");
    streamState.sent.length = 0;

    await notifyClients("deck-4", { actor: "agent" });

    expect(mockRecordChange).not.toHaveBeenCalled();
    expect(streamState.sent).toEqual([]);
  });

  it("sends existing deck events only to subscribers with resolved access", async () => {
    mockWhere.mockResolvedValue([
      { ownerEmail: "owner@example.com", orgId: "org-1", visibility: "org" },
    ]);
    await connectClient("owner@example.com", "org-1");
    await connectClient("member@example.com", "org-1");
    await connectClient("outsider@example.com", "org-2");
    streamState.sent.length = 0;
    mockResolveAccess.mockImplementation(
      async (_type: string, _deckId: string, context: { userEmail: string }) =>
        context.userEmail === "outsider@example.com"
          ? null
          : { role: "viewer" },
    );

    await notifyClients("deck-1", { actor: "agent" });

    expect(streamState.sent).toHaveLength(2);
    expect(streamState.sent.map((data) => JSON.parse(data))).toEqual([
      expect.objectContaining({ type: "deck-changed", deckId: "deck-1" }),
      expect.objectContaining({ type: "deck-changed", deckId: "deck-1" }),
    ]);
    expect(mockResolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(mockResolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
      userEmail: "member@example.com",
      orgId: "org-1",
    });
    expect(mockResolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
      userEmail: "outsider@example.com",
      orgId: "org-2",
    });
  });

  it("keeps an access lookup failure scoped to that client", async () => {
    mockWhere.mockResolvedValue([
      { ownerEmail: "owner@example.com", orgId: "org-1", visibility: "org" },
    ]);
    await connectClient("owner@example.com", "org-1");
    await connectClient("unavailable@example.com", "org-1");
    await connectClient("member@example.com", "org-1");
    streamState.sent.length = 0;
    mockResolveAccess.mockImplementation(
      async (
        _type: string,
        _deckId: string,
        context: { userEmail: string },
      ) => {
        if (context.userEmail === "unavailable@example.com") {
          throw new Error("sharing store unavailable");
        }
        return { role: "viewer" };
      },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await notifyClients("deck-1", { actor: "agent" });

      expect(streamState.sent).toHaveLength(2);
      expect(errorSpy).toHaveBeenCalledWith(
        "[slides] notifyClients: failed to resolve deck access for deck deck-1",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("omits presenter notes from change events", async () => {
    mockWhere.mockResolvedValue([
      { ownerEmail: "owner@example.com", orgId: "org-1", visibility: "org" },
    ]);
    await connectClient("owner@example.com", "org-1");
    streamState.sent.length = 0;

    await notifyClients("deck-1", {
      slideId: "slide-1",
      actor: "agent",
      notes: "Presenter-only notes",
    } as Parameters<typeof notifyClients>[1]);

    expect(mockRecordChange.mock.calls[0][0]).not.toHaveProperty("notes");
    expect(JSON.parse(streamState.sent[0])).not.toHaveProperty("notes");
  });

  it("preserves pre-delete scope for access-aware deletion events, skipping the row lookup", async () => {
    await connectClient("recipient@example.com", "org-1");
    await connectClient("other@example.com", "org-1");
    streamState.sent.length = 0;

    await notifyClients("deck-1", {
      type: "deck-deleted",
      owner: "recipient@example.com",
    });

    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-deleted",
      key: "deck-1",
      resourceType: "deck",
      resourceId: "deck-1",
      owner: "recipient@example.com",
      deckId: "deck-1",
    });
    expect(streamState.sent).toHaveLength(1);
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("sends an organization deletion tombstone only to that organization's clients", async () => {
    await connectClient("member@example.com", "org-1");
    await connectClient("other@example.com", "org-2");
    streamState.sent.length = 0;

    await notifyClients("deck-1", {
      type: "deck-deleted",
      orgId: "org-1",
    });

    expect(streamState.sent).toHaveLength(1);
    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("stamps the writing tab so other viewers can tell it from their own echo", async () => {
    await runWithRequestContext(
      { userEmail: "owner@example.com", run: { browserTabId: "tab-owner" } },
      () =>
        notifyClients("deck-1", { type: "deck-deleted", visibility: "public" }),
    );

    expect(mockRecordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deck-deleted",
        requestSource: "tab-owner",
      }),
    );
  });

  it("leaves requestSource off events written outside a browser request", async () => {
    await notifyClients("deck-1", { type: "deck-deleted", owner: "a@b.co" });

    expect(mockRecordChange.mock.calls[0][0]).not.toHaveProperty(
      "requestSource",
    );
  });

  it("preserves public scope for deletion tombstones, skipping the row lookup", async () => {
    await connectClient("owner@example.com", "org-1");
    await connectClient("viewer@example.com", "org-2");
    streamState.sent.length = 0;

    await notifyClients("deck-1", {
      type: "deck-deleted",
      visibility: "public",
    });

    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-deleted",
      key: "deck-1",
      resourceType: "deck",
      resourceId: "deck-1",
      visibility: "public",
      deckId: "deck-1",
    });
    expect(streamState.sent).toHaveLength(2);
  });
});
