import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordChange = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  createEventStream: vi.fn(),
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server/poll", () => ({
  recordChange: (...args: unknown[]) => mockRecordChange(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: vi.fn(),
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

import { notifyClients } from "./decks";

describe("notifyClients", () => {
  beforeEach(() => {
    mockRecordChange.mockClear();
    mockWhere.mockReset();
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

  it("falls back to an unscoped event when the deck row lookup fails", async () => {
    mockWhere.mockRejectedValue(new Error("db unavailable"));

    await notifyClients("deck-3", { actor: "agent" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-changed",
      key: "deck-3",
      resourceType: "deck",
      resourceId: "deck-3",
      actor: "agent",
      deckId: "deck-3",
    });
  });

  it("falls back to an unscoped event when the deck row is gone", async () => {
    mockWhere.mockResolvedValue([]);

    await notifyClients("deck-4", { actor: "agent" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-changed",
      key: "deck-4",
      resourceType: "deck",
      resourceId: "deck-4",
      actor: "agent",
      deckId: "deck-4",
    });
  });

  it("preserves pre-delete scope for access-aware deletion events, skipping the row lookup", async () => {
    await notifyClients("deck-1", {
      type: "deck-deleted",
      owner: "owner@example.com",
      orgId: "org-1",
    });

    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-deleted",
      key: "deck-1",
      resourceType: "deck",
      resourceId: "deck-1",
      owner: "owner@example.com",
      orgId: "org-1",
      deckId: "deck-1",
    });
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
  });
});
