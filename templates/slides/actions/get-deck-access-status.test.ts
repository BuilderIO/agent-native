import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  viewerEmail: "viewer@example.com" as string | null,
  viewerName: "Viewer" as string | null,
  deck: { id: "deck-1", visibility: "private" } as
    | { id: string; visibility: string }
    | undefined,
  access: null as { role?: string } | null,
}));

const limitSelect = vi.hoisted(() =>
  vi.fn(async () => (state.deck ? [state.deck] : [])),
);
const db = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: limitSelect })),
    })),
  })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: { id: "decks.id", visibility: "decks.visibility" },
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.viewerEmail,
  getRequestUserName: () => state.viewerName,
}));

vi.mock("@agent-native/core/sharing", () => ({
  currentAccess: () => ({ userEmail: state.viewerEmail }),
  resolveAccess: vi.fn(async () => state.access),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

import action from "./get-deck-access-status";

beforeEach(() => {
  vi.clearAllMocks();
  state.viewerEmail = "viewer@example.com";
  state.viewerName = "Viewer";
  state.deck = { id: "deck-1", visibility: "private" };
  state.access = null;
});

describe("get-deck-access-status", () => {
  it("returns safe private-deck metadata without deck content", async () => {
    const result = await action.run({ deckId: "deck-1" });

    expect(result).toEqual({
      exists: true,
      hasAccess: false,
      signedIn: true,
      viewerEmail: "viewer@example.com",
      viewerName: "Viewer",
      role: null,
      visibility: "private",
    });
    expect(result).not.toHaveProperty("data");
  });

  it("reports missing decks without leaking content or access details", async () => {
    state.deck = undefined;
    state.viewerEmail = null;
    state.viewerName = null;

    await expect(action.run({ deckId: "missing" })).resolves.toEqual({
      exists: false,
      hasAccess: false,
      signedIn: false,
      viewerEmail: null,
      viewerName: null,
      role: null,
      visibility: null,
    });
  });

  it("returns the resolved role for an authorized viewer", async () => {
    state.deck = { id: "deck-1", visibility: "org" };
    state.access = { role: "editor" };

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      exists: true,
      hasAccess: true,
      role: "editor",
      visibility: "org",
    });
  });
});
