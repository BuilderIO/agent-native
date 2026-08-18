import { describe, expect, it, vi } from "vitest";

import {
  DECK_FILTER_STORAGE_KEY,
  readStoredDeckFilter,
  resolveDeckFilter,
  writeStoredDeckFilter,
} from "./deck-filter";

describe("deck filter preference", () => {
  it("defaults to Mine when no URL or saved choice exists", () => {
    expect(resolveDeckFilter(null, undefined)).toBe("mine");
  });

  it("restores a saved choice when the URL does not specify a filter", () => {
    expect(resolveDeckFilter(null, "all")).toBe("all");
    expect(resolveDeckFilter(null, "mine")).toBe("mine");
  });

  it("lets an explicit URL filter override the saved choice", () => {
    expect(resolveDeckFilter("me", "all")).toBe("mine");
    expect(resolveDeckFilter("all", "mine")).toBe("all");
  });

  it("reads only valid saved filter values", () => {
    const storage = {
      getItem: vi.fn(() => "mine"),
    };
    expect(readStoredDeckFilter(storage)).toBe("mine");
    expect(storage.getItem).toHaveBeenCalledWith(DECK_FILTER_STORAGE_KEY);

    storage.getItem.mockReturnValue("invalid");
    expect(readStoredDeckFilter(storage)).toBeUndefined();
  });

  it("writes the selected filter", () => {
    const storage = { setItem: vi.fn() };

    expect(writeStoredDeckFilter("all", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      DECK_FILTER_STORAGE_KEY,
      "all",
    );
  });

  it("treats unavailable storage as a best-effort fallback", () => {
    const readStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };
    const writeStorage = {
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(readStoredDeckFilter(readStorage)).toBeUndefined();
    expect(writeStoredDeckFilter("mine", writeStorage)).toBe(false);
  });
});
