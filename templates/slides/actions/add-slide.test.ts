import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

let deckData: Record<string, unknown>;
let updatedFields: Record<string, unknown> | undefined;

const whereSelectFn = vi.fn(async () => [
  {
    id: "deck-1",
    data: JSON.stringify(deckData),
  },
]);
const fromFn = vi.fn(() => ({ where: whereSelectFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));

const whereUpdateFn = vi.fn(async () => undefined);
const setFn = vi.fn((fields: Record<string, unknown>) => {
  updatedFields = fields;
  return { where: whereUpdateFn };
});
const updateFn = vi.fn(() => ({ set: setFn }));

const mockDb = { select: selectFn, update: updateFn };

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: { id: "id_col", data: "data_col", updatedAt: "ua_col" },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

import action from "./add-slide";

beforeEach(() => {
  vi.clearAllMocks();
  deckData = {
    title: "Test deck",
    slides: [
      { id: "slide-1", content: "<div>One</div>" },
      { id: "slide-2", content: "<div>Two</div>" },
    ],
  };
  updatedFields = undefined;
});

describe("add-slide", () => {
  it("accepts CLI-style string positions and inserts at the requested index", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
      position: "1",
    });

    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      position: 1,
      slideCount: 3,
    });
    expect(updatedFields).toBeDefined();
    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.slides.map((slide: { id: string }) => slide.id)).toEqual([
      "slide-1",
      "slide-new",
      "slide-2",
    ]);
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });
});
