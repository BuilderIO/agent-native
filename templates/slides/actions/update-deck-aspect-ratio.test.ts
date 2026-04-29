import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock dependencies BEFORE importing the action ---
// The action calls these at module top-level via imports; vi.mock is hoisted
// so the action sees our stubs the moment it loads.

const mockAssertAccess = vi.fn();
const mockWriteAppState = vi.fn();
const mockNotifyClients = vi.fn();

let mockDeckRow: { id: string; data: string } | undefined = undefined;
let updatedFields: Record<string, unknown> | undefined = undefined;

const limitFn = vi.fn(async () => (mockDeckRow ? [mockDeckRow] : []));
const whereSelectFn = vi.fn(() => ({ limit: limitFn }));
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
  schema: { decks: { id: "id_col", data: "data_col", updatedAt: "ua_col" } },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Import AFTER mocks are registered.
import action from "./update-deck-aspect-ratio";

beforeEach(() => {
  vi.clearAllMocks();
  mockDeckRow = {
    id: "deck-1",
    data: JSON.stringify({
      title: "T",
      slides: [{ id: "s1" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  };
  updatedFields = undefined;
});

describe("update-deck-aspect-ratio action", () => {
  it("writes the new aspectRatio into the deck's data JSON", async () => {
    const result = await action.run({
      deckId: "deck-1",
      aspectRatio: "1:1",
    });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(updatedFields).toBeDefined();
    const dataJson = JSON.parse(updatedFields!.data as string);
    expect(dataJson.aspectRatio).toBe("1:1");
    // Existing fields preserved
    expect(dataJson.title).toBe("T");
    expect(dataJson.slides).toEqual([{ id: "s1" }]);
    // updatedAt bumped (in JSON and in row)
    expect(dataJson.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(updatedFields!.updatedAt).toBe(dataJson.updatedAt);
    expect(result).toEqual({ id: "deck-1", aspectRatio: "1:1" });
  });

  it("notifies SSE clients and writes a refresh-signal", async () => {
    await action.run({ deckId: "deck-1", aspectRatio: "9:16" });
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ source: "update-deck-aspect-ratio" }),
    );
  });

  it("overwrites a previously-set aspectRatio", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "T",
      slides: [],
      aspectRatio: "16:9",
    });
    await action.run({ deckId: "deck-1", aspectRatio: "4:5" });
    const dataJson = JSON.parse(updatedFields!.data as string);
    expect(dataJson.aspectRatio).toBe("4:5");
  });

  it("throws when the deck row does not exist", async () => {
    mockDeckRow = undefined;
    await expect(
      action.run({ deckId: "missing", aspectRatio: "16:9" }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects an unknown aspect ratio at the schema boundary", async () => {
    await expect(
      action.run({ deckId: "deck-1", aspectRatio: "21:9" as never }),
    ).rejects.toThrow();
    // The DB write must NOT have happened.
    expect(updatedFields).toBeUndefined();
    // assertAccess also should not have run for an invalid input.
    expect(mockAssertAccess).not.toHaveBeenCalled();
  });

  it("propagates assertAccess failure (e.g. viewer trying to edit)", async () => {
    mockAssertAccess.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      action.run({ deckId: "deck-1", aspectRatio: "16:9" }),
    ).rejects.toThrow(/forbidden/i);
    expect(updatedFields).toBeUndefined();
  });
});
