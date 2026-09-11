import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILD_CACHE_BUSTER_PARAM,
  reloadForClientCompatibilityMismatch,
  stripBuildCompatibilityCacheBuster,
} from "./build-compatibility.js";

function compatibilityWindow(
  href = "https://content.example/page/one?view=all",
) {
  const values = new Map<string, string>();
  const replace = vi.fn();
  const replaceState = vi.fn();
  return {
    win: {
      location: { href, replace },
      history: { state: { key: "value" }, replaceState },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    } as any,
    replace,
    replaceState,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("client build compatibility recovery", () => {
  it("hard-navigates once to a cache-busted copy of the current page", () => {
    const { win, replace } = compatibilityWindow();

    expect(
      reloadForClientCompatibilityMismatch("build-2", "spaces-v1", win),
    ).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
    const target = new URL(replace.mock.calls[0]![0]);
    expect(target.pathname).toBe("/page/one");
    expect(target.searchParams.get("view")).toBe("all");
    expect(target.searchParams.get(BUILD_CACHE_BUSTER_PARAM)).toBe("build-2");

    expect(
      reloadForClientCompatibilityMismatch("build-2", "spaces-v1", win),
    ).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });

  it("uses an in-memory loop guard when Safari storage access throws", () => {
    const { win, replace } = compatibilityWindow();
    win.sessionStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(
      reloadForClientCompatibilityMismatch("build-3", "spaces-v1", win),
    ).toBe(true);
    expect(
      reloadForClientCompatibilityMismatch("build-3", "spaces-v1", win),
    ).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });

  it("removes only the compatibility cache buster after hydration", () => {
    const { win, replaceState } = compatibilityWindow(
      "https://content.example/page/one?view=all&__an_build=build-2",
    );

    stripBuildCompatibilityCacheBuster(win);

    const target = new URL(replaceState.mock.calls[0]![2]);
    expect(target.searchParams.get("view")).toBe("all");
    expect(target.searchParams.has(BUILD_CACHE_BUSTER_PARAM)).toBe(false);
  });
});
