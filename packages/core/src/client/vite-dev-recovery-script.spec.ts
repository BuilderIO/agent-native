// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getViteDevRecoveryScript } from "./vite-dev-recovery-script.js";

function runScript() {
  new Function(getViteDevRecoveryScript())();
}

describe("getViteDevRecoveryScript", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
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
});
