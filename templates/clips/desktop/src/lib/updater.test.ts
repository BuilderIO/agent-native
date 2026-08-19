import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  check: vi.fn(),
  isMacPlatform: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: mocks.exit,
  relaunch: mocks.relaunch,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("./platform", () => ({
  isMacPlatform: mocks.isMacPlatform,
}));

async function loadUpdater() {
  return import("./updater");
}

function makeUpdate() {
  const install = vi.fn(async () => {});
  const download = vi.fn(async (progress: (event: unknown) => void) => {
    progress({
      event: "Started",
      data: { contentLength: 10 },
    });
    progress({
      event: "Progress",
      data: { chunkLength: 10 },
    });
    progress({
      event: "Finished",
      data: {},
    });
  });
  return {
    version: "1.2.3",
    body: "release notes",
    install,
    download,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  vi.stubGlobal("__CLIPS_DESKTOP_LOCAL_BUILD__", false);
  mocks.isMacPlatform.mockReturnValue(true);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "restart_bundle_path") {
      return "/Applications/Clips.app";
    }
    if (command === "schedule_restart_after_exit") {
      return undefined;
    }
    throw new Error(`Unexpected invoke: ${command}`);
  });
});

describe("installAndRestart", () => {
  it("captures the stable bundle path before install and hands off on macOS", async () => {
    const update = makeUpdate();
    mocks.check.mockResolvedValue(update);
    const { retryUpdateCheck, installAndRestart } = await loadUpdater();

    await retryUpdateCheck();
    await installAndRestart();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "restart_bundle_path");
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "schedule_restart_after_exit",
      {
        bundlePath: "/Applications/Clips.app",
      },
    );
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(mocks.exit).toHaveBeenCalledWith(0);
  });

  it("falls back to the plugin relaunch path off macOS", async () => {
    mocks.isMacPlatform.mockReturnValue(false);
    const update = makeUpdate();
    mocks.check.mockResolvedValue(update);
    const { retryUpdateCheck, installAndRestart } = await loadUpdater();

    await retryUpdateCheck();
    await installAndRestart();

    expect(mocks.invoke).toHaveBeenCalledWith("restart_bundle_path");
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "schedule_restart_after_exit",
      {
        bundlePath: "/Applications/Clips.app",
      },
    );
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
  });
});
