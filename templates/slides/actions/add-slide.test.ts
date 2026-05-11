import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
// Each test sets this; the helper consults it to decide whether to report
// overflow, fit, or timeout.
let mockFitCheckResult:
  | { status: "fits" | "overflows" | "timeout"; measurement?: unknown }
  | undefined;

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

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => null,
  writeAppState: async () => undefined,
}));

vi.mock("./_await-fit-check.js", () => ({
  awaitLayoutFitCheck: async () => mockFitCheckResult ?? { status: "timeout" },
  formatOverflowForTool: (deckId: string, m: { verticalOverflow: number }) =>
    `MOCK_OVERFLOW_MESSAGE deck=${deckId} overflow=${m.verticalOverflow}`,
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
  it("does not advertise parallel execution for deck writes", () => {
    expect(action.parallelSafe).toBeUndefined();
  });

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

  it("rejects empty string positions", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
        position: "",
      }),
    ).rejects.toThrow();
  });

  it("rejects null positions", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
        position: null as unknown as number,
      }),
    ).rejects.toThrow();
  });

  it("appends layoutOverflow + auto-fix message when the editor reports vertical overflow", async () => {
    mockFitCheckResult = {
      status: "overflows",
      measurement: {
        slideId: "slide-new",
        contentHeight: 645,
        viewportHeight: 420,
        verticalOverflow: 225,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      layoutOverflow: {
        verticalOverflow: 225,
        contentHeight: 645,
        viewportHeight: 420,
      },
    });
    expect(result.message).toMatch(/MOCK_OVERFLOW_MESSAGE/);
  });

  it("omits layoutOverflow when the editor reports the slide fits", async () => {
    mockFitCheckResult = {
      status: "fits",
      measurement: {
        slideId: "slide-new",
        contentHeight: 380,
        viewportHeight: 420,
        verticalOverflow: 0,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("omits layoutOverflow when no editor is open to measure (timeout)", async () => {
    mockFitCheckResult = { status: "timeout" };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      slideCount: 3,
    });
  });
});
