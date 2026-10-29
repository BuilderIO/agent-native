// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDesignHomeLibraryInitialState,
  clearDesignHomeLibraryTabSelection,
  setDesignHomeLibraryTab,
  subscribeToDesignHomeLibraryTab,
} from "./home-library-state";

describe("Design home library state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-design-home-library-tab");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-design-home-library-tab");
  });

  it("uses cached library availability for the first-paint tab", () => {
    window.localStorage.setItem("design-home-has-recents", "true");

    expect(readDesignHomeLibraryInitialState(false)).toEqual({
      tab: "recent",
      userSelected: false,
    });
  });

  it("keeps a first-paint tab selection through hydration", () => {
    window.localStorage.setItem("design-home-has-recents", "true");
    document.documentElement.setAttribute(
      "data-design-home-library-tab",
      "templates",
    );

    expect(readDesignHomeLibraryInitialState(false)).toEqual({
      tab: "templates",
      userSelected: true,
    });
  });

  it("notifies a mounted home page when a shell tab is selected", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToDesignHomeLibraryTab(onChange);

    setDesignHomeLibraryTab("templates");

    expect(onChange).toHaveBeenCalledWith("templates");
    expect(
      document.documentElement.getAttribute("data-design-home-library-tab"),
    ).toBe("templates");
    unsubscribe();
  });

  it("clears the shell handoff after hydration", () => {
    document.documentElement.setAttribute(
      "data-design-home-library-tab",
      "templates",
    );

    clearDesignHomeLibraryTabSelection();

    expect(
      document.documentElement.hasAttribute("data-design-home-library-tab"),
    ).toBe(false);
  });
});
