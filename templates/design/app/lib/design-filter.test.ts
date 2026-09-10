import { describe, expect, it, vi } from "vitest";

import {
  DESIGN_FILTER_STORAGE_KEY,
  readStoredDesignFilter,
  writeStoredDesignFilter,
} from "./design-filter";

describe("design filter preference", () => {
  it("reads only valid saved filter values", () => {
    const storage = {
      getItem: vi.fn(() => "mine"),
    };

    expect(readStoredDesignFilter(storage)).toBe("mine");
    expect(storage.getItem).toHaveBeenCalledWith(DESIGN_FILTER_STORAGE_KEY);

    storage.getItem.mockReturnValue("invalid");
    expect(readStoredDesignFilter(storage)).toBeUndefined();
  });

  it("writes the selected filter", () => {
    const storage = { setItem: vi.fn() };

    expect(writeStoredDesignFilter("all", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      DESIGN_FILTER_STORAGE_KEY,
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

    expect(readStoredDesignFilter(readStorage)).toBeUndefined();
    expect(writeStoredDesignFilter("mine", writeStorage)).toBe(false);
  });
});
