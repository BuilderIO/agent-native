import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: Parameters<typeof mockAssertAccess>) =>
    mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: Parameters<typeof mockNotifyClients>) =>
    mockNotifyClients(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  }),
  schema: { decks: { id: "decks.id" } },
}));

import action from "./apply-design-system.js";

function accessFor(data: string) {
  return { role: "owner" as const, resource: { data } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apply-design-system", () => {
  it("links a ready design system to the deck", async () => {
    mockAssertAccess
      .mockResolvedValueOnce(accessFor("{}")) // deck access
      .mockResolvedValueOnce(
        accessFor(JSON.stringify({ colors: {} })), // locally authored -> ready
      );

    const result = await action.run({
      deckId: "deck-1",
      designSystemId: "ds-1",
    });

    expect(result).toEqual({
      deckId: "deck-1",
      designSystemId: "ds-1",
      applied: true,
    });
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("rejects a design system that is still indexing", async () => {
    mockAssertAccess
      .mockResolvedValueOnce(accessFor("{}"))
      .mockResolvedValueOnce(
        accessFor(
          JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
        ),
      );

    await expect(
      action.run({ deckId: "deck-1", designSystemId: "ds-1" }),
    ).rejects.toThrow(/still indexing/);
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects a design system whose data is unreadable", async () => {
    mockAssertAccess
      .mockResolvedValueOnce(accessFor("{}"))
      .mockResolvedValueOnce(accessFor("not json"));

    await expect(
      action.run({ deckId: "deck-1", designSystemId: "ds-1" }),
    ).rejects.toThrow(/unavailable/);
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });
});
