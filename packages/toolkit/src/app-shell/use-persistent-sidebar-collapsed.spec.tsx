// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type PersistentSidebarCollapsedState,
  usePersistentSidebarCollapsed,
} from "./use-persistent-sidebar-collapsed.js";

const STORAGE_KEY = "test.sidebar.collapsed";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("usePersistentSidebarCollapsed", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: PersistentSidebarCollapsedState;
  let browserStorage: MemoryStorage;

  function Harness({ defaultCollapsed = false }) {
    state = usePersistentSidebarCollapsed({
      storageKey: STORAGE_KEY,
      defaultCollapsed,
    });
    return null;
  }

  function render(defaultCollapsed = false) {
    act(() => root.render(<Harness defaultCollapsed={defaultCollapsed} />));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    browserStorage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: browserStorage,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the expanded default without writing a missing preference", () => {
    render();

    expect(state.collapsed).toBe(false);
    expect(state.persistenceStatus).toBe("available");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("restores %s synchronously", (stored, collapsed) => {
    window.localStorage.setItem(STORAGE_KEY, stored);
    render(!collapsed);

    expect(state.collapsed).toBe(collapsed);
    expect(state.persistenceStatus).toBe("available");
  });

  it("persists explicit updates and restores them on remount", () => {
    render();

    act(() => state.setCollapsed((value) => !value));

    expect(state.collapsed).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(state.collapsed).toBe(true);
  });

  it("distinguishes malformed stored values from a valid preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "sometimes");
    render();

    expect(state.collapsed).toBe(false);
    expect(state.persistenceStatus).toBe("invalid");
  });

  it("replaces an invalid value after an explicit choice", () => {
    window.localStorage.setItem(STORAGE_KEY, "sometimes");
    render();

    act(() => state.setCollapsed(true));

    expect(state.persistenceStatus).toBe("available");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("keeps in-memory updates when browser storage is unavailable", () => {
    vi.spyOn(browserStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    render();

    act(() => state.setCollapsed(true));

    expect(state.collapsed).toBe(true);
    expect(state.persistenceStatus).toBe("unavailable");
  });

  it("reports unavailable storage during the initial read", () => {
    vi.spyOn(browserStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    render(true);

    expect(state.collapsed).toBe(true);
    expect(state.persistenceStatus).toBe("unavailable");
  });

  it("uses the caller default when rendered without a browser", () => {
    function ServerProbe() {
      const { collapsed, persistenceStatus } = usePersistentSidebarCollapsed({
        storageKey: STORAGE_KEY,
        defaultCollapsed: true,
      });
      return `${String(collapsed)}:${persistenceStatus}`;
    }
    vi.stubGlobal("window", undefined);

    expect(renderToString(createElement(ServerProbe))).toContain(
      "true:unavailable",
    );

    vi.unstubAllGlobals();
  });
});
