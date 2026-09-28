// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getViteDevRecoveryScript } from "./vite-dev-recovery-script.js";

function runScript() {
  new Function(getViteDevRecoveryScript())();
}

describe("getViteDevRecoveryScript", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    delete (window as unknown as Record<string, unknown>)[
      "__agentNativeViteDevRecoveryInstalled"
    ];
    window.sessionStorage.removeItem("__an_optimize_reload");
    vi.restoreAllMocks();
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
