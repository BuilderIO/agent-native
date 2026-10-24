import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  compareAndSetAppState: vi.fn(),
  readAppState: vi.fn(),
  queue: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mocks.compareAndSetAppState(...args),
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  };
});

import action from "./control-presenter";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queue = null;
  mocks.readAppState.mockImplementation(async () => mocks.queue);
  mocks.compareAndSetAppState.mockImplementation(
    async (_key: string, expected: Record<string, unknown> | null, next) => {
      if (JSON.stringify(mocks.queue) !== JSON.stringify(expected)) {
        return false;
      }
      mocks.queue = next;
      return true;
    },
  );
  mockDeckSlides(3);
});

function mockDeckSlides(slideCount: number) {
  mocks.assertAccess.mockResolvedValue({
    resource: {
      data: JSON.stringify({
        appId: "slides-2",
        slides: Array.from({ length: slideCount }, (_, index) => ({
          id: `slide-${index + 1}`,
        })),
      }),
    },
  });
}

describe("control-presenter", () => {
  it("queues next for an accessible deck in SQL application state", async () => {
    const result = await action.run({ operation: "next", deckId: "deck-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "slides-2:presenter-control-queue",
      null,
      {
        commands: [
          expect.objectContaining({
            commandId: expect.any(String),
            deckId: "deck-1",
            issuedAt: expect.any(Number),
            operation: "next",
          }),
        ],
      },
    );
    expect(result).toMatchObject({
      deckId: "deck-1",
      message: "Presenter command queued for the open console.",
      operation: "next",
    });
  });

  it("preserves commands within the clock-skew window and keeps goto numbers 1-based", async () => {
    mocks.queue = {
      commands: [
        {
          commandId: "f2417c5b-7231-49ed-8814-ea65278e61ea",
          deckId: "deck-1",
          issuedAt: Date.now() + 10_000,
          operation: "previous",
        },
      ],
    };

    await action.run({ operation: "goto", deckId: "deck-1", slideNumber: 3 });

    expect(mocks.queue?.commands).toHaveLength(2);
    expect(mocks.queue?.commands[1]).toMatchObject({
      deckId: "deck-1",
      operation: "goto",
      slideNumber: 3,
    });
  });

  it("rejects a goto beyond the deck's slide count before queueing it", async () => {
    await expect(
      action.run({ operation: "goto", deckId: "deck-1", slideNumber: 4 }),
    ).rejects.toMatchObject({ errorCode: "slide_number_out_of_range" });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("checks viewer access before reading slide numbers for a goto", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("forbidden"));

    await expect(
      action.run({ operation: "goto", deckId: "deck-1", slideNumber: 1 }),
    ).rejects.toThrow("forbidden");

    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("queues blackout mode and does not write when viewer access is denied", async () => {
    const result = await action.run({
      operation: "blackout",
      deckId: "deck-1",
      mode: "white",
    });
    expect(result).toMatchObject({ operation: "blackout", mode: "white" });

    mocks.assertAccess.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      action.run({ operation: "next", deckId: "deck-2" }),
    ).rejects.toThrow("forbidden");
    expect(mocks.readAppState).toHaveBeenCalledTimes(1);
  });

  it("queues a deck switch only after checking viewer access to both decks", async () => {
    const result = await action.run({
      operation: "switch-deck",
      deckId: "deck-1",
      targetDeckId: "deck-2",
    });

    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      1,
      "deck",
      "deck-1",
      "viewer",
    );
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      2,
      "deck",
      "deck-2",
      "viewer",
    );
    expect(result).toMatchObject({
      deckId: "deck-1",
      operation: "switch-deck",
      targetDeckId: "deck-2",
    });

    vi.clearAllMocks();
    mocks.readAppState.mockImplementation(async () => mocks.queue);
    mocks.compareAndSetAppState.mockImplementation(
      async (_key: string, expected: Record<string, unknown> | null, next) => {
        if (JSON.stringify(mocks.queue) !== JSON.stringify(expected)) {
          return false;
        }
        mocks.queue = next;
        return true;
      },
    );
    mocks.assertAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("target deck forbidden"));

    await expect(
      action.run({
        operation: "switch-deck",
        deckId: "deck-1",
        targetDeckId: "deck-3",
      }),
    ).rejects.toThrow("target deck forbidden");
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });
});
