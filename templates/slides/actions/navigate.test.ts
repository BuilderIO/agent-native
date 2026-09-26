import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("navigate", () => {
  it("opens templates with a selected template and search", async () => {
    await action.run({
      view: "templates",
      templateId: "starter-pitch",
      search: "pitch",
    });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        view: "templates",
        templateId: "starter-pitch",
        search: "pitch",
      }),
    );
  });
  it("rejects contradictory template and deck destinations", async () => {
    await expect(
      action.run({ view: "templates", deckId: "deck-1" }),
    ).rejects.toThrow("cannot target a deck");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
  it("treats slideNumber as the 1-based UI slide number", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideNumber: 1,
    });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        deckId: "deck-1",
        slideIndex: 0,
      }),
    );
    expect(result).toContain("slide:1");
  });

  it("keeps legacy slideIndex as a zero-based internal value", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideIndex: 1,
    });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        deckId: "deck-1",
        slideIndex: 1,
      }),
    );
    expect(result).toContain("slide:2");
  });
});
