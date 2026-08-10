import { describe, expect, it, vi } from "vitest";

import {
  initializeDesktopStartup,
  resolveDesktopSsoBrokerStatePath,
} from "./desktop-startup.js";

function createDependencies(
  overrides: Partial<Parameters<typeof initializeDesktopStartup>[0]> = {},
) {
  const events: string[] = [];
  return {
    events,
    dependencies: {
      isPackaged: true,
      version: "0.1.150-desktop-sso-canary.20",
      appDataPath: "/application-support",
      createDirectory: vi.fn(() => events.push("create-directory")),
      setUserDataPath: vi.fn(() => events.push("set-user-data")),
      initializeSentry: vi.fn(() => events.push("sentry")),
      initializeLogger: vi.fn(() => events.push("logger")),
      logError: vi.fn(),
      logWarning: vi.fn(),
      ...overrides,
    },
  };
}

describe("initializeDesktopStartup", () => {
  it("keeps local broker state inside the active Desktop profile", () => {
    expect(resolveDesktopSsoBrokerStatePath("/isolated-canary-profile")).toBe(
      "/isolated-canary-profile/desktop-sso.json",
    );
  });

  it("isolates a packaged canary before initializing profile consumers", () => {
    const { dependencies, events } = createDependencies();

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/application-support/Agent Native SSO Canary",
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent Native SSO Canary",
    );
    expect(events).toEqual([
      "create-directory",
      "set-user-data",
      "sentry",
      "logger",
    ]);
  });

  it("aborts packaged canary startup when profile isolation fails", () => {
    const failure = new Error("read-only volume");
    const { dependencies } = createDependencies({
      createDirectory: vi.fn(() => {
        throw failure;
      }),
    });

    expect(() => initializeDesktopStartup(dependencies)).toThrow(failure);
    expect(dependencies.logError).toHaveBeenCalledWith(
      "[main] failed to isolate packaged userData directory:",
      failure,
    );
    expect(dependencies.setUserDataPath).not.toHaveBeenCalled();
    expect(dependencies.initializeSentry).not.toHaveBeenCalled();
    expect(dependencies.initializeLogger).not.toHaveBeenCalled();
  });

  it("preserves stable Desktop's existing profile", () => {
    const { dependencies, events } = createDependencies({
      version: "0.1.150",
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).not.toHaveBeenCalled();
    expect(dependencies.setUserDataPath).not.toHaveBeenCalled();
    expect(events).toEqual(["sentry", "logger"]);
  });

  it("keeps development startup recoverable when profile isolation fails", () => {
    const failure = new Error("read-only volume");
    const { dependencies, events } = createDependencies({
      isPackaged: false,
      createDirectory: vi.fn(() => {
        throw failure;
      }),
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.logWarning).toHaveBeenCalledWith(
      "[main] failed to isolate userData directory:",
      failure,
    );
    expect(events).toEqual(["sentry", "logger"]);
  });
});
