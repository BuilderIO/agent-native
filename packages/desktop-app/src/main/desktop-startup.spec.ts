import { describe, expect, it, vi } from "vitest";

import {
  desktopRequestedUserDataPath,
  initializeDesktopStartup,
  resolveDesktopSsoBrokerStatePath,
  resolveStableUserDataPath,
  runDesktopStartupStep,
  type DesktopStartupDependencies,
} from "./desktop-startup.js";

describe("desktopRequestedUserDataPath", () => {
  it("uses Electron's switch when Chromium strips it from argv", () => {
    expect(
      desktopRequestedUserDataPath("/tmp/electron-profile", ["Agent-Native"]),
    ).toBe("/tmp/electron-profile");
  });

  it("keeps the argv fallback for ordinary launches", () => {
    expect(
      desktopRequestedUserDataPath("", [
        "Agent-Native",
        "--user-data-dir=/tmp/argv-profile",
      ]),
    ).toBe("/tmp/argv-profile");
  });
});

function createDependencies(
  overrides: Partial<Parameters<typeof initializeDesktopStartup>[0]> = {},
): { events: string[]; dependencies: DesktopStartupDependencies } {
  const events: string[] = [];
  return {
    events,
    dependencies: {
      isPackaged: true,
      version: "0.1.150-desktop-sso-canary.20",
      appDataPath: "/application-support",
      defaultUserDataPath: "/application-support/Agent-Native",
      pathExists: vi.fn(() => false),
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

  it("keeps existing stable Desktop data in the legacy product directory", () => {
    const legacyPath = "/application-support/Agent Native"; // agent-native-brand-ok: preserve the legacy Electron profile directory.
    expect(
      resolveStableUserDataPath(
        "/application-support",
        "/application-support/Agent-Native",
        (directoryPath) => directoryPath === legacyPath,
      ),
    ).toBe(legacyPath);
  });

  it("stops startup and cleans up when shutdown wins an async startup race", async () => {
    let finishStart: () => void = () => undefined;
    let shuttingDown = false;
    const abort = vi.fn(async () => undefined);
    const startup = runDesktopStartupStep({
      start: () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        }),
      isShuttingDown: () => shuttingDown,
      abort,
    });

    shuttingDown = true;
    finishStart();

    await expect(startup).resolves.toBe(false);
    expect(abort).toHaveBeenCalledOnce();
  });

  it("continues startup without cleanup when the async step finishes first", async () => {
    const abort = vi.fn(async () => undefined);

    await expect(
      runDesktopStartupStep({
        start: async () => undefined,
        isShuttingDown: () => false,
        abort,
      }),
    ).resolves.toBe(true);
    expect(abort).not.toHaveBeenCalled();
  });

  it("isolates a packaged canary before initializing profile consumers", () => {
    const { dependencies, events } = createDependencies();

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/application-support/Agent Native SSO Canary", // agent-native-brand-ok: preserve the legacy Electron profile directory.
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent Native SSO Canary", // agent-native-brand-ok: preserve the legacy Electron profile directory.
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

  it("uses the new stable profile directory for new installs", () => {
    const { dependencies, events } = createDependencies({
      version: "0.1.150",
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/application-support/Agent-Native",
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent-Native",
    );
    expect(events).toEqual([
      "create-directory",
      "set-user-data",
      "sentry",
      "logger",
    ]);
  });

  it("uses the legacy stable profile directory when it already exists", () => {
    const { dependencies } = createDependencies({
      version: "0.1.150",
      pathExists: vi.fn(
        (directoryPath) =>
          directoryPath === "/application-support/Agent Native", // agent-native-brand-ok: preserve the legacy Electron profile directory.
      ),
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent Native", // agent-native-brand-ok: preserve the legacy Electron profile directory.
    );
  });

  it("reuses the legacy stable profile for packaged Nightly", () => {
    const { dependencies, events } = createDependencies({
      version: "0.1.150-nightly.296",
      defaultUserDataPath: "/application-support/Agent-Native Nightly",
      pathExists: vi.fn(
        (directoryPath) =>
          directoryPath === "/application-support/Agent Native", // agent-native-brand-ok: preserve the legacy Electron profile directory.
      ),
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/application-support/Agent Native", // agent-native-brand-ok: preserve the legacy Electron profile directory.
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent Native", // agent-native-brand-ok: preserve the legacy Electron profile directory.
    );
    expect(events).toEqual([
      "create-directory",
      "set-user-data",
      "sentry",
      "logger",
    ]);
  });

  it("keeps a packaged Nightly install on its default profile when no legacy profile exists", () => {
    const { dependencies } = createDependencies({
      version: "0.1.150-nightly.296",
      defaultUserDataPath: "/application-support/Agent-Native Nightly",
      pathExists: vi.fn(() => false),
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/application-support/Agent-Native Nightly",
    );
  });

  it("uses an explicit profile for packaged Desktop before profile consumers", () => {
    const { dependencies, events } = createDependencies({
      requestedUserDataPath: "/tmp/acceptance-profile",
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/tmp/acceptance-profile",
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/tmp/acceptance-profile",
    );
    expect(events).toEqual([
      "create-directory",
      "set-user-data",
      "sentry",
      "logger",
    ]);
  });

  it("uses an explicit profile instead of the packaged canary profile", () => {
    const { dependencies } = createDependencies({
      version: "0.1.150-desktop-sso-canary.30",
      requestedUserDataPath: "/tmp/acceptance-profile",
    });

    initializeDesktopStartup(dependencies);

    expect(dependencies.createDirectory).toHaveBeenCalledWith(
      "/tmp/acceptance-profile",
    );
    expect(dependencies.setUserDataPath).toHaveBeenCalledWith(
      "/tmp/acceptance-profile",
    );
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
