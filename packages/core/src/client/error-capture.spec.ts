import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureException,
  captureMessage,
  getErrorCaptureStats,
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
  event: Partial<PromiseRejectionEvent> = {},
) {
  for (const listener of listeners.unhandledrejection ?? []) {
    listener({ reason, ...event });
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

  it("drops stackless stale module loader failures", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();

    const dispose = installErrorCapture({ send });
    fireError(listeners, {
      message: "Importing a module script failed.",
    });
    const dynamicImportError = new TypeError(
      "Failed to fetch dynamically imported module: /assets/route.js",
    );
    dynamicImportError.stack = "";
    fireRejection(listeners, dynamicImportError);

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

  it("drops extension fetch failures with a destination suffix", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const extensionError = new TypeError(
      "Failed to fetch (api2.amplitude.com)",
    );
    extensionError.stack =
      "TypeError: Failed to fetch (api2.amplitude.com)\n    at fetch (chrome-extension://test/frame_ant.js:1:1)";

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

  it("does not recapture prevented browser errors", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    fireError(listeners, {
      defaultPrevented: true,
      message: "Failed to fetch dynamically imported module: /assets/route.js",
    });
    fireRejection(
      listeners,
      new Error(
        "Failed to fetch dynamically imported module: /assets/route.js",
      ),
      { defaultPrevented: true },
    );

    expect(send).not.toHaveBeenCalled();
    dispose();
  });
});

function stackOf(error: Error, stack: string): Error {
  error.stack = stack;
  return error;
}

describe("installErrorCapture shared noise rules", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any)[errorCaptureStateKey];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drops a Chrome stale-chunk failure whose stack is only its header line", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });
    const message =
      "Failed to fetch dynamically imported module: https://beta.slides.agent-native.com/assets/AgentSidebarPanel-3f2a.js";

    fireRejection(
      listeners,
      stackOf(new TypeError(message), `TypeError: ${message}`),
    );

    expect(send).not.toHaveBeenCalled();
    expect(getErrorCaptureStats().noiseSuppressed["stale-chunk"]).toBe(1);
    dispose();
  });

  it("drops opaque cross-origin 'Script error.' events", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    fireError(listeners, { message: "Script error." });

    expect(send).not.toHaveBeenCalled();
    expect(getErrorCaptureStats().noiseSuppressed["opaque-script-error"]).toBe(
      1,
    );
    dispose();
  });

  it("drops the Vector pixel's 'Domain not allowed' rejection and its fetch failures", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    fireRejection(
      listeners,
      stackOf(
        new Error("Domain not allowed"),
        "Error: Domain not allowed\n    at https://cdn.vector.co/pixel.js:2:15234",
      ),
    );
    fireRejection(
      listeners,
      stackOf(
        new TypeError("Failed to fetch (api.vector.co)"),
        [
          "TypeError: Failed to fetch (api.vector.co)",
          "    at window.fetch (https://analytics.agent-native.com/assets/api-path-Bx1.js:1:2210)",
          "    at https://cdn.vector.co/pixel.js:2:9876",
        ].join("\n"),
      ),
    );

    expect(send).not.toHaveBeenCalled();
    expect(getErrorCaptureStats().noiseSuppressed["third-party-origin"]).toBe(
      2,
    );
    dispose();
  });

  it("drops stackless network failures but keeps ones our own code issued", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    fireRejection(listeners, stackOf(new TypeError("Load failed"), ""));
    expect(send).not.toHaveBeenCalled();

    fireRejection(
      listeners,
      stackOf(
        new TypeError("Failed to fetch"),
        "TypeError: Failed to fetch\n    at loadDashboard (https://analytics.agent-native.com/assets/app.js:10:2)",
      ),
    );
    expect(send).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("applies the same rules to explicit captureException() calls, but never to messages", () => {
    const { listeners: _listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    captureException(
      stackOf(
        new Error("Domain not allowed"),
        "Error: Domain not allowed\n    at https://cdn.vector.co/pixel.js:2:15234",
      ),
    );
    expect(send).not.toHaveBeenCalled();

    captureMessage("Script error.", "warning");
    expect(send).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("installErrorCapture flood budget", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any)[errorCaptureStateKey];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("caps one repeating signature at three events and counts the rest", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send, dedupeWindowMs: 0 });

    for (let i = 0; i < 12; i += 1) {
      fireRejection(listeners, new Error(`poll failed for run ${i}`));
    }

    expect(send).toHaveBeenCalledTimes(3);
    expect(getErrorCaptureStats()).toMatchObject({ sent: 3, budgetDropped: 9 });
    dispose();
  });

  it("bounds a session of distinct events and reports what it dropped", () => {
    vi.useFakeTimers();
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send, dedupeWindowMs: 0 });

    // 20 events, then new signatures keep passing up to twice the cap.
    for (let i = 0; i < 50; i += 1) {
      fireRejection(listeners, new Error(`distinct failure ${"x".repeat(i)}`));
    }
    expect(send).toHaveBeenCalledTimes(40);
    expect(getErrorCaptureStats().budgetDropped).toBe(10);

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(41);
    const summary = send.mock.calls[40][0] as CapturedExceptionEvent;
    expect(summary).toMatchObject({
      type: "ErrorBudgetExceeded",
      handled: true,
      level: "warning",
    });
    expect(summary.extra).toMatchObject({ dropped: 10, sent: 40 });
    dispose();
  });

  it("still reports the first event of a brand-new signature after the session cap", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send, dedupeWindowMs: 0 });

    for (let i = 0; i < 20; i += 1) {
      fireRejection(listeners, new Error(`known failure ${"x".repeat(i)}`));
    }
    expect(send).toHaveBeenCalledTimes(20);

    fireRejection(listeners, new Error("a bug nobody has hit yet"));
    expect(send).toHaveBeenCalledTimes(21);
    expect(send.mock.calls[20][0]).toMatchObject({
      message: "a bug nobody has hit yet",
    });

    // A signature already counted this session is still capped.
    fireRejection(listeners, new Error("known failure "));
    expect(send).toHaveBeenCalledTimes(21);
    dispose();
  });

  it("never lets distinct signatures grow the session past twice its cap", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({
      send,
      dedupeWindowMs: 0,
      maxEventsPerSession: 5,
    });

    for (let i = 0; i < 40; i += 1) {
      fireRejection(listeners, new Error(`storm ${"x".repeat(i)}`));
    }
    expect(send).toHaveBeenCalledTimes(10);
    dispose();
  });

  it("keeps the dropped-signature map bounded, and empty once summaries run out", () => {
    vi.useFakeTimers();
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({
      send,
      dedupeWindowMs: 0,
      maxEventsPerSession: 1,
      budgetSummaryDelayMs: 1_000,
    });
    const budget = () =>
      (globalThis as any)[errorCaptureStateKey].budget as {
        dropped: number;
        droppedBySignature: Map<string, number>;
      };
    const storm = (round: string) => {
      for (let i = 0; i < 120; i += 1) {
        fireRejection(listeners, new Error(`storm ${round} ${"x".repeat(i)}`));
      }
    };

    storm("a");
    expect(budget().droppedBySignature.size).toBeLessThanOrEqual(51);
    expect(budget().droppedBySignature.get("other")).toBeGreaterThan(0);
    // The overflow bucket still counts every drop.
    const counted = [...budget().droppedBySignature.values()].reduce(
      (a, b) => a + b,
      0,
    );
    expect(counted).toBe(budget().dropped);

    vi.advanceTimersByTime(1_000);
    storm("b");
    vi.advanceTimersByTime(1_000);
    storm("c");
    vi.advanceTimersByTime(1_000);
    const summaries = send.mock.calls.filter(
      ([event]) =>
        (event as CapturedExceptionEvent).type === "ErrorBudgetExceeded",
    );
    expect(summaries).toHaveLength(3);

    // No fourth summary will ever be sent, so nothing accumulates for one.
    storm("d");
    expect(budget().droppedBySignature.size).toBe(0);
    expect(budget().dropped).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getErrorCaptureStats().budgetDropped).toBeGreaterThan(300);
    dispose();
  });

  it("still dedupes identical errors inside the dedupe window", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    for (let i = 0; i < 5; i += 1) {
      fireRejection(listeners, new Error("same failure"));
    }

    expect(send).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("installErrorCapture stale-chunk recovery exhaustion", () => {
  const exhaustedKey = "__agentNativeStaleChunkRecoveryExhausted";

  afterEach(() => {
    delete (globalThis as any)[errorCaptureStateKey];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports one typed event per page session when recovery gives up after install", () => {
    const { listeners } = installBrowser();
    const send = vi.fn();
    const dispose = installErrorCapture({ send });

    // The raw failure is still noise: recovery owns it.
    fireRejection(
      listeners,
      new TypeError(
        "Failed to fetch dynamically imported module: https://a.test/assets/x.js",
      ),
    );
    expect(send).not.toHaveBeenCalled();

    const detail = { reason: "cooldown" };
    for (let i = 0; i < 3; i += 1) {
      for (const listener of listeners[
        "agent-native:stale-chunk-recovery-exhausted"
      ] ?? []) {
        listener({ detail });
      }
    }

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      type: "RouteChunkRecoveryExhausted",
      handled: true,
      level: "error",
      tags: { context: "route_chunk_recovery_exhausted", reason: "cooldown" },
    });
    dispose();
  });

  it("reports recovery that gave up before capture installed, once across reinstalls", () => {
    installBrowser();
    (window as any)[exhaustedKey] = { reason: "desktop" };
    const send = vi.fn();

    installErrorCapture({ send })();
    installErrorCapture({ send })();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      type: "RouteChunkRecoveryExhausted",
      tags: { reason: "desktop" },
    });
  });

  it("reports nothing while recovery has not given up", () => {
    installBrowser();
    const send = vi.fn();
    installErrorCapture({ send })();
    expect(send).not.toHaveBeenCalled();
  });
});
