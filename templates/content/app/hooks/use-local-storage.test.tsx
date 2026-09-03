// @vitest-environment happy-dom

import { act, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLocalStorage } from "./use-local-storage";

function createTestStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("useLocalStorage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createTestStorage(),
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    window.localStorage.clear();
  });

  it("updates same-tab hooks that share a key", () => {
    const values: Record<string, boolean> = {};
    const setters: Record<string, (value: boolean) => void> = {};
    const renderPhaseWarnings: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (
        typeof args[0] === "string" &&
        args[0].includes("Cannot update a component")
      ) {
        renderPhaseWarnings.push(args);
      }
    };

    try {
      function Probe({ id }: { id: string }) {
        const [value, setValue] = useLocalStorage("shared-key", false);
        values[id] = value;
        setters[id] = setValue;
        return null;
      }

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <>
            <Probe id="a" />
            <Probe id="b" />
          </>,
        );
      });

      expect(values).toEqual({ a: false, b: false });

      act(() => {
        setters.a(true);
      });

      expect(values).toEqual({ a: true, b: true });
      expect(renderPhaseWarnings).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });

  it("exposes the new key value during the key-transition render", () => {
    const renderedValues: boolean[] = [];
    window.localStorage.setItem("document-a", JSON.stringify(true));
    window.localStorage.setItem("document-b", JSON.stringify(false));

    function Probe({ storageKey }: { storageKey: string }) {
      const [value] = useLocalStorage(storageKey, false);
      renderedValues.push(value);
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<Probe storageKey="document-a" />);
    });
    expect(renderedValues[renderedValues.length - 1]).toBe(true);

    const firstTransitionRender = renderedValues.length;
    flushSync(() => {
      root?.render(<Probe storageKey="document-b" />);
    });
    expect(renderedValues[firstTransitionRender]).toBe(false);
  });

  it("uses the new key value for functional updates before passive effects", () => {
    let transitionSetterCalled = false;
    window.localStorage.setItem("document-a", JSON.stringify(true));
    window.localStorage.setItem("document-b", JSON.stringify(false));

    function Probe({ storageKey }: { storageKey: string }) {
      const [, setValue] = useLocalStorage(storageKey, false);

      useLayoutEffect(() => {
        if (storageKey !== "document-b" || transitionSetterCalled) return;
        transitionSetterCalled = true;
        setValue((previous) => !previous);
      }, [setValue, storageKey]);

      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<Probe storageKey="document-a" />);
    });

    flushSync(() => {
      root?.render(<Probe storageKey="document-b" />);
    });

    expect(window.localStorage.getItem("document-b")).toBe("true");
  });
});
