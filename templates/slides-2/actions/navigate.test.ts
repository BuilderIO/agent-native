import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();
const mockRequestContext = vi.hoisted(() => ({
  browserTabId: undefined as string | undefined,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => ({
    browserTabId: mockRequestContext.browserTabId,
  }),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequestContext.browserTabId = undefined;
});

describe("navigate", () => {
  it("opens templates with a selected template and search", async () => {
    await action.run({
      view: "templates",
      templateId: "starter-pitch",
      search: "pitch",
    });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate",
      expect.objectContaining({
        app: "slides-2",
        view: "templates",
        templateId: "starter-pitch",
        search: "pitch",
      }),
    );
  });
  it("opens the Home recent tab with a deck search", async () => {
    await action.run({ view: "list", deckSearch: "roadmap" });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate",
      expect.objectContaining({
        app: "slides-2",
        view: "list",
        homeTab: "recent",
        deckSearch: "roadmap",
      }),
    );
  });
  it("navigates to shared decks", async () => {
    await action.run({ view: "list", deckFilter: "shared" });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate",
      expect.objectContaining({
        app: "slides-2",
        view: "list",
        deckFilter: "shared",
      }),
    );
  });
  it("rejects deck search from the Home templates tab", async () => {
    await expect(
      action.run({ view: "list", homeTab: "templates", deckSearch: "pitch" }),
    ).rejects.toThrow("Deck search requires the Home recent tab.");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
  it("rejects deck filters from the Home templates tab", async () => {
    await expect(
      action.run({ view: "list", homeTab: "templates", deckFilter: "shared" }),
    ).rejects.toThrow("Deck filter requires the Home recent tab.");
    expect(mockWriteAppState).not.toHaveBeenCalled();
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
      "slides-2:navigate",
      expect.objectContaining({
        app: "slides-2",
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
      "slides-2:navigate",
      expect.objectContaining({
        app: "slides-2",
        deckId: "deck-1",
        slideIndex: 1,
      }),
    );
    expect(result).toContain("slide:2");
  });

  it.each(["editor", "present"] as const)(
    "requires a deck ID before navigating to %s",
    async (view) => {
      await expect(action.run({ view })).rejects.toMatchObject({
        errorCode: "deck_id_required",
        statusCode: 400,
      });
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("rejects a deck destination combined with the Home list view", async () => {
    await expect(
      action.run({ view: "list", deckId: "deck-1" }),
    ).rejects.toMatchObject({
      errorCode: "invalid_home_navigation",
      statusCode: 400,
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("writes navigation commands to the requesting browser tab", async () => {
    mockRequestContext.browserTabId = "tab-1";

    await action.run({ view: "editor", deckId: "deck-1", slideNumber: 2 });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate:tab-1",
      expect.objectContaining({
        app: "slides-2",
        view: "editor",
        deckId: "deck-1",
        slideIndex: 1,
      }),
    );
  });
});
