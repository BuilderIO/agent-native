// @agent-native/pinpoint — freezeReact tests
// MIT License
//
// freezeReact() reads `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` and patches the
// dispatcher it finds there. There's no jsdom/happy-dom available to this
// package (see selector-builder.spec.ts), so we install a minimal fake
// `window` carrying just the DevTools hook shape getInternals() reads
// (`renderers` — a Map whose first value exposes `currentDispatcherRef`).
// The proxy/dispatcher-patching logic itself is exercised for real: we don't
// stub freezeReact's own behavior, only the browser global it looks for.
//
// `frozen` / `originalDispatcher` / `queuedUpdates` are module-level state
// shared across every test in this file, so each test that gets a *real*
// (non-no-op) cleanup back from freezeReact() must call it before the test
// ends — otherwise later tests would see `isReactFrozen() === true` already.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freezeReact, isReactFrozen } from "./react-freeze.js";

let originalWindow: unknown;

beforeEach(() => {
  originalWindow = (globalThis as any).window;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = originalWindow;
  }
});

/** Installs a fake React DevTools hook and returns the dispatcher ref it exposes. */
function installDevtoolsHook(dispatcher: any): { current: any } {
  const currentDispatcherRef = { current: dispatcher };
  const renderers = new Map([[1, { currentDispatcherRef }]]);
  (globalThis as any).window = {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: { renderers },
  };
  return currentDispatcherRef;
}

describe("freezeReact", () => {
  it("is a no-op when window has no React DevTools hook", () => {
    (globalThis as any).window = {};

    const unfreeze = freezeReact();

    expect(isReactFrozen()).toBe(false);
    expect(() => unfreeze()).not.toThrow();
  });

  it("is a no-op when the DevTools hook has no registered renderers", () => {
    (globalThis as any).window = {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: { renderers: new Map() },
    };

    const unfreeze = freezeReact();

    expect(isReactFrozen()).toBe(false);
    unfreeze();
  });

  it("swaps in a proxy dispatcher and reports frozen while active", () => {
    const dispatcher = { useState: vi.fn(() => ["a", vi.fn()]) };
    const dispatcherRef = installDevtoolsHook(dispatcher);

    const unfreeze = freezeReact();

    expect(isReactFrozen()).toBe(true);
    expect(dispatcherRef.current).not.toBe(dispatcher);

    unfreeze();
  });

  it("restores the original dispatcher reference on unfreeze", () => {
    const dispatcher = { useState: vi.fn(() => ["a", vi.fn()]) };
    const dispatcherRef = installDevtoolsHook(dispatcher);

    const unfreeze = freezeReact();
    unfreeze();

    expect(dispatcherRef.current).toBe(dispatcher);
    expect(isReactFrozen()).toBe(false);
  });

  it("queues a useState setter call instead of applying it immediately, then flushes on unfreeze", () => {
    let value = "initial";
    const setValue = vi.fn((next: string) => {
      value = next;
    });
    const dispatcher = { useState: vi.fn(() => [value, setValue]) };
    const dispatcherRef = installDevtoolsHook(dispatcher);

    const unfreeze = freezeReact();

    // A component re-rendering while frozen would call useState() through
    // the proxy — simulate that call directly.
    const [, queuedSetter] = dispatcherRef.current.useState();
    queuedSetter("updated");

    // Queued, not applied yet.
    expect(setValue).not.toHaveBeenCalled();
    expect(value).toBe("initial");

    unfreeze();

    expect(setValue).toHaveBeenCalledWith("updated");
    expect(value).toBe("updated");
  });

  it("flushes multiple queued updates in call order and tolerates a setter that throws", () => {
    const calls: string[] = [];
    const goodSetter = vi.fn((action: string) => calls.push(`good:${action}`));
    const throwingSetter = vi.fn(() => {
      throw new Error("component unmounted");
    });
    let callIndex = 0;
    const setters = [goodSetter, throwingSetter, goodSetter];
    const dispatcher = {
      useState: vi.fn(() => ["v", setters[callIndex++]]),
    };
    const dispatcherRef = installDevtoolsHook(dispatcher);

    const unfreeze = freezeReact();

    const [, setterA] = dispatcherRef.current.useState();
    const [, setterB] = dispatcherRef.current.useState();
    const [, setterC] = dispatcherRef.current.useState();
    setterA("first");
    setterB("second");
    setterC("third");

    expect(() => unfreeze()).not.toThrow();

    expect(calls).toEqual(["good:first", "good:third"]);
    expect(throwingSetter).toHaveBeenCalledWith("second");
  });

  it("calling freeze again while already frozen returns a true no-op and does not reset state", () => {
    const dispatcher = { useState: vi.fn(() => ["a", vi.fn()]) };
    installDevtoolsHook(dispatcher);

    const unfreeze1 = freezeReact();
    expect(isReactFrozen()).toBe(true);

    const unfreeze2 = freezeReact();
    unfreeze2();
    expect(isReactFrozen()).toBe(true); // still frozen — unfreeze2 was a no-op

    unfreeze1();
    expect(isReactFrozen()).toBe(false);
  });
});
