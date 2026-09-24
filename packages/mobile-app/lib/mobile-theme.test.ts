import { describe, expect, it, vi } from "vitest";

import { buildMobileGuestThemeScript } from "./mobile-theme";

function runMobileThemeScript(theme: "light" | "dark") {
  const listeners = new Map<
    string,
    Array<(event: { detail?: unknown }) => void>
  >();
  const childFrame = { postMessage: vi.fn() };
  const documentElement = {
    classList: {
      values: new Set<string>(),
      toggle(name: string, enabled: boolean) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name: string) {
        return this.values.has(name);
      },
      add(name: string) {
        this.values.add(name);
      },
      remove(...names: string[]) {
        for (const name of names) this.values.delete(name);
      },
    },
    dataset: {} as Record<string, string>,
    style: {
      colorScheme: "",
    },
    setAttribute(name: string, value: string) {
      if (name === "data-theme") this.dataset.theme = value;
    },
    removeAttribute(name: string) {
      if (name === "data-theme") delete this.dataset.theme;
    },
  };
  const localStorage = {
    store: new Map<string, string>(),
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      this.store.set(key, value);
    },
    removeItem(key: string) {
      this.store.delete(key);
    },
  };
  const windowMock = {
    localStorage,
    frames: [childFrame],
    console: {
      warn: vi.fn(),
    },
    dispatchEvent(event: { type: string; detail?: unknown }) {
      for (const handler of listeners.get(event.type) ?? []) {
        handler(event);
      }
      return true;
    },
    addEventListener(
      type: string,
      handler: (event: { detail?: unknown }) => void,
    ) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(
      type: string,
      handler: (event: { detail?: unknown }) => void,
    ) {
      const handlers = listeners.get(type);
      if (!handlers) return;
      listeners.set(
        type,
        handlers.filter((candidate) => candidate !== handler),
      );
    },
  };
  const CustomEventMock = class {
    type: string;
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  const documentMock = {
    documentElement,
  };

  let detail: unknown;
  const onThemeChange = (event: { detail?: unknown }) => {
    detail = event.detail;
  };
  windowMock.addEventListener("agent-native:theme-change", onThemeChange);

  try {
    const script = buildMobileGuestThemeScript(theme);
    new Function(
      "window",
      "document",
      "CustomEvent",
      `return eval(${JSON.stringify(script)})`,
    )(windowMock, documentMock, CustomEventMock);

    return { childFrame, detail, documentElement, localStorage };
  } finally {
    windowMock.removeEventListener("agent-native:theme-change", onThemeChange);
  }
}

describe("buildMobileGuestThemeScript", () => {
  it.each([
    ["light", false],
    ["dark", true],
  ] as const)(
    "applies %s mode to the document and child frames",
    (theme, isDark) => {
      const { childFrame, detail, documentElement, localStorage } =
        runMobileThemeScript(theme);

      expect(documentElement.classList.contains("dark")).toBe(isDark);
      expect(documentElement.classList.contains("light")).toBe(!isDark);
      expect(documentElement.dataset.theme).toBe(theme);
      expect(documentElement.style.colorScheme).toBe(theme);
      expect(localStorage.getItem("theme")).toBe(theme);
      expect(detail).toEqual({
        type: "agent-native-theme-update",
        theme,
        isDark,
      });
      expect(childFrame.postMessage).toHaveBeenCalledTimes(1);
      expect(childFrame.postMessage).toHaveBeenCalledWith(
        {
          type: "agent-native-theme-update",
          theme,
          isDark,
        },
        "*",
      );
    },
  );
});
