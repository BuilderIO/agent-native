import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const notification = Object.assign(
    vi.fn(function () {
      return {
        on: vi.fn(),
        show: vi.fn(),
      };
    }),
    {
      isSupported: vi.fn(() => false),
    },
  );
  return {
    app: {
      isPackaged: true,
      getVersion: vi.fn(() => "1.0.0"),
      whenReady: vi.fn(() => new Promise<void>(() => {})),
      on: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
      quit: vi.fn(),
    },
    browserWindow: {
      getAllWindows: vi.fn(() => []),
    },
    ipcMain: {
      handlers,
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      ),
    },
    notification,
  };
});

const updaterState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const updater = {
    handlers,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
      return updater;
    }),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  return updater;
});

vi.mock("electron", () => ({
  app: electronState.app,
  BrowserWindow: electronState.browserWindow,
  ipcMain: electronState.ipcMain,
  Notification: electronState.notification,
}));

vi.mock("electron-updater", () => ({ autoUpdater: updaterState }));

import { IPC } from "@shared/ipc-channels";

let checkForAppUpdates: typeof import("./updates.js").checkForAppUpdates;
let getCurrentUpdateStatus: typeof import("./updates.js").getCurrentUpdateStatus;
let isInstallingDownloadedUpdate: typeof import("./updates.js").isInstallingDownloadedUpdate;
let isPreparingDownloadedUpdate: typeof import("./updates.js").isPreparingDownloadedUpdate;
let requestQuitAfterUpdatePreparation: typeof import("./updates.js").requestQuitAfterUpdatePreparation;
let registerUpdatesIpc: typeof import("./updates.js").registerUpdatesIpc;

describe("desktop updates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    electronState.app.isPackaged = true;
    electronState.ipcMain.handlers.clear();
    updaterState.handlers.clear();
    updaterState.checkForUpdates.mockReset();
    updaterState.downloadUpdate.mockReset();
    updaterState.quitAndInstall.mockReset();
    electronState.notification.isSupported.mockReturnValue(false);
    vi.resetModules();
    ({
      checkForAppUpdates,
      getCurrentUpdateStatus,
      isInstallingDownloadedUpdate,
      isPreparingDownloadedUpdate,
      requestQuitAfterUpdatePreparation,
      registerUpdatesIpc,
    } = await import("./updates.js"));
  });

  it("shows a clear result when a manual check finds no update", async () => {
    updaterState.checkForUpdates.mockResolvedValue(undefined);
    electronState.notification.isSupported.mockReturnValue(true);

    const focusMainWindow = vi.fn();
    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow,
    });

    const checkPromise = checkForAppUpdates({ notifyOnResult: true });
    updaterState.handlers.get("update-not-available")?.({
      version: "1.0.0",
    });
    await checkPromise;

    expect(getCurrentUpdateStatus()).toEqual({
      state: "not-available",
      currentVersion: "1.0.0",
    });
    expect(electronState.notification).toHaveBeenCalledWith({
      title: "Agent Native is up to date",
      body: "You're running the latest version (1.0.0).",
    });
    expect(focusMainWindow).not.toHaveBeenCalled();
  });

  it("does not advertise a macOS update until native staging finishes", async () => {
    let resolveDownload!: () => void;
    const downloadPromise = new Promise<void>((resolve) => {
      resolveDownload = resolve;
    });
    updaterState.checkForUpdates.mockResolvedValue({ downloadPromise });

    const refreshApplicationMenu = vi.fn();
    registerUpdatesIpc({
      refreshApplicationMenu,
      focusMainWindow: vi.fn(),
    });

    const checkPromise = checkForAppUpdates();
    await Promise.resolve();

    const updateDownloaded = updaterState.handlers.get("update-downloaded");
    updateDownloaded?.({ version: "1.1.0", releaseNotes: "Fixes" });
    await Promise.resolve();

    expect(getCurrentUpdateStatus()).toEqual({ state: "idle" });
    expect(refreshApplicationMenu).not.toHaveBeenCalled();

    resolveDownload();
    await checkPromise;

    expect(getCurrentUpdateStatus()).toEqual({
      state: "downloaded",
      version: "1.1.0",
      releaseNotes: "Fixes",
    });
    expect(electronState.ipcMain.handlers.has(IPC.UPDATE_INSTALL)).toBe(true);

    updaterState.checkForUpdates.mockClear();
    updaterState.downloadUpdate.mockClear();
    await expect(checkForAppUpdates()).resolves.toEqual({
      state: "downloaded",
      version: "1.1.0",
      releaseNotes: "Fixes",
    });

    const downloadHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_DOWNLOAD,
    );
    expect(downloadHandler).toBeDefined();
    await expect(downloadHandler!()).resolves.toEqual({
      state: "downloaded",
      version: "1.1.0",
      releaseNotes: "Fixes",
    });
    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();
    expect(updaterState.downloadUpdate).not.toHaveBeenCalled();
  });

  it("does not start another check while native staging is pending", async () => {
    const refreshApplicationMenu = vi.fn();
    registerUpdatesIpc({
      refreshApplicationMenu,
      focusMainWindow: vi.fn(),
    });

    updaterState.handlers.get("update-downloaded")?.({
      version: "1.1.0",
    });

    await expect(checkForAppUpdates()).resolves.toEqual({ state: "idle" });

    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();
    expect(refreshApplicationMenu).not.toHaveBeenCalled();
  });

  it("closes native helpers before handing an update to Squirrel", async () => {
    const prepareForUpdate = vi.fn(async () => undefined);
    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
      prepareForUpdate,
    });
    updaterState.handlers.get("update-downloaded")?.({
      version: "1.1.0",
    });

    const installHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_INSTALL,
    );
    await installHandler?.();

    expect(prepareForUpdate).toHaveBeenCalledOnce();
    expect(isInstallingDownloadedUpdate()).toBe(true);
    expect(updaterState.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("does not own user quits while helper preparation is still pending", async () => {
    let resolvePreparation!: () => void;
    const prepareForUpdate = vi.fn(
      () => new Promise<void>((resolve) => (resolvePreparation = resolve)),
    );
    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
      prepareForUpdate,
    });
    updaterState.handlers.get("update-downloaded")?.({
      version: "1.1.0",
    });

    const installHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_INSTALL,
    );
    const install = installHandler?.();
    await vi.waitFor(() => expect(prepareForUpdate).toHaveBeenCalledOnce());
    expect(isPreparingDownloadedUpdate()).toBe(true);
    expect(isInstallingDownloadedUpdate()).toBe(false);

    resolvePreparation();
    await install;
    expect(isPreparingDownloadedUpdate()).toBe(false);
    expect(isInstallingDownloadedUpdate()).toBe(true);
    expect(updaterState.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("keeps a downloaded update retryable after an asynchronous install error", async () => {
    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
    });
    updaterState.handlers.get("update-downloaded")?.({
      version: "1.1.0",
    });

    const installHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_INSTALL,
    );
    await installHandler?.();
    expect(updaterState.quitAndInstall).toHaveBeenCalledTimes(1);

    updaterState.handlers.get("error")?.(new Error("installer failed"));

    expect(getCurrentUpdateStatus()).toEqual({
      state: "downloaded",
      version: "1.1.0",
    });
    expect(isPreparingDownloadedUpdate()).toBe(false);
    expect(isInstallingDownloadedUpdate()).toBe(false);
    await installHandler?.();
    expect(updaterState.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it("completes a deferred quit after helper preparation fails and restores retry state", async () => {
    const prepareForUpdate = vi.fn(async () => {
      requestQuitAfterUpdatePreparation();
      throw new Error("helper close failed");
    });
    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
      prepareForUpdate,
    });
    updaterState.handlers.get("update-downloaded")?.({
      version: "1.1.0",
    });

    const installHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_INSTALL,
    );
    await installHandler?.();

    expect(getCurrentUpdateStatus()).toEqual({
      state: "downloaded",
      version: "1.1.0",
    });
    expect(isPreparingDownloadedUpdate()).toBe(false);
    expect(isInstallingDownloadedUpdate()).toBe(false);
    expect(electronState.app.quit).toHaveBeenCalledOnce();
    expect(updaterState.quitAndInstall).not.toHaveBeenCalled();
  });

  it("keeps un-packaged development updates explicitly unsupported", async () => {
    electronState.app.isPackaged = false;
    vi.stubGlobal("__AGENT_NATIVE_DESKTOP_BUILD_CHANNEL__", "dev");
    vi.resetModules();
    const updates = await import("./updates.js");

    updates.registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
    });

    expect(updates.getCurrentUpdateStatus()).toEqual({
      state: "unsupported",
      reason: "Auto-update is unavailable for local development builds",
    });
    expect(updaterState.setFeedURL).not.toHaveBeenCalled();
    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();

    await expect(updates.checkForAppUpdates()).resolves.toEqual({
      state: "unsupported",
      reason: "Auto-update is unavailable for local development builds",
    });
    expect(updaterState.setFeedURL).not.toHaveBeenCalled();
    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();

    const installHandler = electronState.ipcMain.handlers.get(
      IPC.UPDATE_INSTALL,
    );
    expect(installHandler).toBeDefined();
    installHandler?.();
    expect(electronState.app.relaunch).not.toHaveBeenCalled();
    expect(electronState.app.exit).not.toHaveBeenCalled();
  });
});
