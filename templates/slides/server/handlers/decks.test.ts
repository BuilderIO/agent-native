import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordChange = vi.hoisted(() => vi.fn());

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

import { notifyClients } from "./decks";

describe("notifyClients", () => {
  beforeEach(() => {
    mockRecordChange.mockClear();
  });

  it("scopes shared sync events to the changed deck", () => {
    notifyClients("deck-1", { slideId: "slide-1", actor: "agent" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "deck",
      type: "deck-changed",
      key: "deck-1",
      resourceType: "deck",
      resourceId: "deck-1",
      slideId: "slide-1",
      actor: "agent",
      deckId: "deck-1",
    });
  });

  it("preserves pre-delete scope for access-aware deletion events", () => {
    notifyClients("deck-1", {
      type: "deck-deleted",
      owner: "owner@example.com",
      orgId: "org-1",
    });

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
});
