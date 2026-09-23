import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  relaunch: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
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
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "restart_after_update") {
      return undefined;
    }
    throw new Error(`Unexpected invoke: ${command}`);
  });
});

describe("runCheck", () => {
  it("keeps a downloaded update staged when a later check fails", async () => {
    mocks.check.mockResolvedValueOnce(makeUpdate());
    const { retryUpdateCheck, isUpdatePendingRestart } = await loadUpdater();

    await retryUpdateCheck();
    expect(isUpdatePendingRestart()).toBe(true);

    mocks.check.mockRejectedValue(new Error("network down"));
    vi.useFakeTimers();
    try {
      const pending = retryUpdateCheck();
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(isUpdatePendingRestart()).toBe(true);
  });
});

describe("installAndRestart", () => {
  it("uses the native restart path after installing an update", async () => {
    const update = makeUpdate();
    mocks.check.mockResolvedValue(update);
    const { retryUpdateCheck, installAndRestart } = await loadUpdater();

    await retryUpdateCheck();
    await installAndRestart();

    expect(update.install).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("restart_after_update");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("falls back to the plugin relaunch path if native restart is unavailable", async () => {
    mocks.invoke.mockRejectedValue(new Error("restart unavailable"));
    const update = makeUpdate();
    mocks.check.mockResolvedValue(update);
    const { retryUpdateCheck, installAndRestart } = await loadUpdater();

    await retryUpdateCheck();
    await installAndRestart();

    expect(mocks.invoke).toHaveBeenCalledWith("restart_after_update");
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });
});
