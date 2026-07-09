import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installErrorCapture,
  type CapturedExceptionEvent,
} from "./error-capture";

const errorCaptureStateKey = Symbol.for("agent-native.client.errorCapture");

function installBrowser() {
  const parsed = new URL("https://analytics.agent-native.com/monitoring");
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const windowMock = {
    location: {
      href: parsed.href,
      origin: parsed.origin,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn(),
    },
    addEventListener: vi.fn((event: string, listener: (event: any) => void) => {
      listeners[event] = [...(listeners[event] ?? []), listener];
    }),
    removeEventListener: vi.fn(
      (event: string, listener: (event: any) => void) => {
        listeners[event] = (listeners[event] ?? []).filter(
          (entry) => entry !== listener,
        );
      },
    ),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("window", windowMock);
  return { listeners };
}

function fireError(
  listeners: Record<string, Array<(event: any) => void>>,
  event: Partial<ErrorEvent>,
) {
  for (const listener of listeners.error ?? []) listener(event);
}

function fireRejection(
  listeners: Record<string, Array<(event: any) => void>>,
  reason: unknown,
) {
  for (const listener of listeners.unhandledrejection ?? []) {
    listener({ reason });
  }
}

describe("installErrorCapture auto-capture filtering", () => {
  afterEach(() => {
    delete (globalThis as any)[errorCaptureStateKey];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drops benign ResizeObserver browser loop errors", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();

    const dispose = installErrorCapture({ send });
    fireError(listeners, {
      message: "ResizeObserver loop completed with undelivered notifications.",
    });
    fireError(listeners, {
      message: "ResizeObserver loop limit exceeded",
    });

    expect(send).not.toHaveBeenCalled();
    dispose();
  });

  it("drops browser extension injected-script fetch failures", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const extensionError = new TypeError("Failed to fetch");
    extensionError.stack =
      "TypeError: Failed to fetch\n    at ViJh (injectScriptAdjust.js:1:1)";

    const dispose = installErrorCapture({ send });
    fireRejection(listeners, extensionError);

    expect(send).not.toHaveBeenCalled();
    dispose();
  });

  it("keeps app fetch failures without extension frames", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const appError = new TypeError("Failed to fetch");
    appError.stack =
      "TypeError: Failed to fetch\n    at loadDashboard (https://analytics.agent-native.com/assets/app.js:10:2)";

    const dispose = installErrorCapture({ send });
    fireRejection(listeners, appError);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject<
      Partial<CapturedExceptionEvent>
    >({
      type: "TypeError",
      message: "Failed to fetch",
    });
    dispose();
  });

  it("drops view-transition invalid-state aborts", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const transitionAbort = new DOMException(
      "Transition was aborted because of invalid state",
      "InvalidStateError",
    );

    const dispose = installErrorCapture({ send });
    fireRejection(listeners, transitionAbort);

    expect(send).not.toHaveBeenCalled();
    dispose();
  });

  it("drops known browser-extension bootstrap errors", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();

    const dispose = installErrorCapture({ send });
    fireError(listeners, {
      message: "This script should only be loaded in a browser extension.",
      filename: "page.js",
      lineno: 36,
      colno: 1,
    });

    expect(send).not.toHaveBeenCalled();
    dispose();
  });
});
