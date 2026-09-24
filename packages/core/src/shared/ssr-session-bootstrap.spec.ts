import { describe, expect, it, vi } from "vitest";

import {
  getSsrSessionBootstrapScriptBody,
  SSR_SESSION_BOOTSTRAP_TIMEOUT_MS,
} from "./ssr-session-bootstrap.js";

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
