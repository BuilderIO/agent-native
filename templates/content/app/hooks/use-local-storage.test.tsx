// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  });
});
