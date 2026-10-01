import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSsrSessionBootstrapScriptBody,
  isSessionNavigationPending,
  navigateForSession,
  SESSION_NAVIGATION_RELEASED_EVENT,
  SESSION_NAVIGATION_STALL_MS,
  SSR_SESSION_BOOTSTRAP_TIMEOUT_MS,
} from "./ssr-session-bootstrap.js";

describe("navigateForSession", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases a claim the page did not leave on, so a later navigation can claim", () => {
    vi.useFakeTimers();
    const replace = vi.fn();
    const page = Object.assign(new EventTarget(), { location: { replace } });
    vi.stubGlobal("window", page);
    const released = vi.fn();
    page.addEventListener(SESSION_NAVIGATION_RELEASED_EVENT, released);

    expect(navigateForSession("/sign-in")).toBe(true);
    expect(navigateForSession("https://beta.example.com/")).toBe(false);

    vi.advanceTimersByTime(SESSION_NAVIGATION_STALL_MS - 1);
    expect(isSessionNavigationPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isSessionNavigationPending()).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);

    expect(navigateForSession("/sign-in")).toBe(true);
    expect(replace).toHaveBeenCalledTimes(2);
  });
});

describe("getSsrSessionBootstrapScriptBody", () => {
  it("starts a hinted request with an abortable deadline", () => {
    const windowObject: { __agentNativeSessionBootstrap?: unknown } = {};
    const abort = vi.fn();
    let deadline: (() => void) | undefined;
    const fetch = vi.fn(() => new Promise(() => {}));

    class TestAbortController {
      signal = {};
      abort = abort;
    }

    const runScript = new Function(
      "window",
      "document",
      "AbortController",
      "setTimeout",
      "clearTimeout",
      "fetch",
      getSsrSessionBootstrapScriptBody("/session", "an_hint"),
    );

    runScript(
      windowObject,
      { cookie: "an_hint=1" },
      TestAbortController,
      (callback: () => void, timeout: number) => {
        expect(timeout).toBe(SSR_SESSION_BOOTSTRAP_TIMEOUT_MS);
        deadline = callback;
        return 1;
      },
      vi.fn(),
      fetch,
    );

    expect(fetch).toHaveBeenCalledWith(
      "/session",
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    deadline?.();
    expect(abort).toHaveBeenCalledOnce();
  });

  it("does not schedule or fetch without the session hint", () => {
    let scheduled = false;
    const fetch = vi.fn();
    const runScript = new Function(
      "window",
      "document",
      "AbortController",
      "setTimeout",
      "clearTimeout",
      "fetch",
      getSsrSessionBootstrapScriptBody("/session", "an_hint"),
    );

    runScript(
      {},
      { cookie: "" },
      class TestAbortController {},
      () => {
        scheduled = true;
        return 1;
      },
      vi.fn(),
      fetch,
    );

    expect(scheduled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
