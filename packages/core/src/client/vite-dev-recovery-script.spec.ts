// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTE_WARMUP_PRELOAD_ATTRIBUTE } from "../shared/route-chunk-recovery-bootstrap.js";
import { getViteDevRecoveryScript } from "./vite-dev-recovery-script.js";

function runScript() {
  new Function(getViteDevRecoveryScript())();
}

describe("getViteDevRecoveryScript", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    delete (window as unknown as Record<string, unknown>)[
      "__agentNativeViteDevRecoveryInstalled"
    ];
    window.sessionStorage.removeItem("__an_optimize_reload");
  });

  it("does not install reload handlers inside MCP app embeds", () => {
    window.history.replaceState(
      null,
      "",
      "/inbox?embedded=1&__an_embed_token=signed-token",
    );
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    expect(addEventListener).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("installs reload handlers for normal dev pages", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");

    runScript();

    expect(addEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "vite:preloadError",
      expect.any(Function),
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
  });

  it("limits generic resource reloads to Vite transformed module URLs", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    const errorHandler = addEventListener.mock.calls.find(
      ([type]) => type === "error",
    )?.[1] as ((event: Event) => void) | undefined;
    expect(errorHandler).toBeTypeOf("function");

    const scheduledAfterInstall = setTimeout.mock.calls.length;
    errorHandler?.({
      target: {
        tagName: "SCRIPT",
        src: "http://localhost:3000/chat/assets/route.js",
      },
    } as unknown as Event);
    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall);

    errorHandler?.({
      target: {
        tagName: "SCRIPT",
        src: "http://localhost:3000/node_modules/.vite/deps/react.js?v=1",
      },
    } as unknown as Event);
    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall + 1);
  });

  it("recovers local Vite entry module failures but ignores external modules", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    const errorHandler = addEventListener.mock.calls.find(
      ([type]) => type === "error",
    )?.[1] as ((event: Event) => void) | undefined;
    expect(errorHandler).toBeTypeOf("function");

    const scheduledAfterInstall = setTimeout.mock.calls.length;
    errorHandler?.({
      target: {
        tagName: "SCRIPT",
        type: "module",
        src: "https://cdn.example.test/src/entry.client.tsx",
      },
    } as unknown as Event);
    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall);

    errorHandler?.({
      target: {
        tagName: "IMG",
        src: "http://localhost:3000/src/entry.client.tsx",
      },
    } as unknown as Event);
    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall);

    errorHandler?.({
      target: {
        tagName: "SCRIPT",
        type: "module",
        src: "http://localhost:3000/src/entry.client.tsx",
      },
    } as unknown as Event);
    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall + 1);
  });

  it("ignores failed speculative route warmup preloads", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    const errorHandler = addEventListener.mock.calls.find(
      ([type]) => type === "error",
    )?.[1] as ((event: Event) => void) | undefined;
    expect(errorHandler).toBeTypeOf("function");

    const scheduledAfterInstall = setTimeout.mock.calls.length;
    errorHandler?.({
      target: {
        tagName: "LINK",
        rel: "modulepreload",
        href: "http://localhost:3000/chat/assets/route.js",
        hasAttribute: (name: string) => name === ROUTE_WARMUP_PRELOAD_ATTRIBUTE,
      },
    } as unknown as Event);

    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall);
  });

  it("bounds retries with a URL marker when sessionStorage is blocked", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        delete (window as unknown as Record<string, unknown>)[
          "__agentNativeViteDevRecoveryInstalled"
        ];
        runScript();
      } else {
        runScript();
      }

      const errorHandlers = addEventListener.mock.calls
        .filter(([type]) => type === "error")
        .map(([, handler]) => handler as (event: Event) => void);
      const scheduledBeforeFailure = setTimeout.mock.calls.length;
      errorHandlers.at(-1)?.({
        target: {
          tagName: "SCRIPT",
          type: "module",
          src: "http://localhost:3000/src/entry.client.tsx",
        },
      } as unknown as Event);

      const recoveryHistory = new URLSearchParams(window.location.search).get(
        "__an_vite_dev_recovery",
      );
      if (attempt <= 3) {
        expect(setTimeout.mock.calls.length).toBeGreaterThan(
          scheduledBeforeFailure,
        );
        expect(recoveryHistory?.split(".")).toHaveLength(attempt);
      } else {
        expect(setTimeout).toHaveBeenCalledTimes(scheduledBeforeFailure);
        expect(recoveryHistory?.split(".")).toHaveLength(3);
        expect(document.getElementById("__an-reload-overlay")).not.toBeNull();
      }
    }
  });

  it("does not treat a React Router route failure as an optimizer failure", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    const rejectionHandler = addEventListener.mock.calls.find(
      ([type]) => type === "unhandledrejection",
    )?.[1] as ((event: Event) => void) | undefined;
    expect(rejectionHandler).toBeTypeOf("function");

    const scheduledAfterInstall = setTimeout.mock.calls.length;
    rejectionHandler?.({
      reason: {
        message:
          "Failed to fetch dynamically imported module: http://localhost:3000/chat/assets/route.js",
      },
      preventDefault: vi.fn(),
    } as unknown as Event);

    expect(setTimeout).toHaveBeenCalledTimes(scheduledAfterInstall);
  });

  it("owns Vite route-module preload failures before React Router reloads", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");

    runScript();

    const preloadHandler = addEventListener.mock.calls.find(
      ([type]) => type === "vite:preloadError",
    )?.[1] as ((event: Event) => void) | undefined;
    expect(preloadHandler).toBeTypeOf("function");

    const preventDefault = vi.fn();
    const scheduledAfterInstall = setTimeout.mock.calls.length;
    preloadHandler?.({
      payload: {
        message:
          "Failed to fetch dynamically imported module: http://localhost:3000/chat/assets/route.js",
      },
      preventDefault,
    } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setTimeout.mock.calls.length).toBeGreaterThan(scheduledAfterInstall);
  });
});
