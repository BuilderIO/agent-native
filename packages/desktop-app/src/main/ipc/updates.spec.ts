import { IPC } from "@shared/ipc-channels";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

let checkForAppUpdates: typeof import("./updates.js").checkForAppUpdates;
let getCurrentUpdateStatus: typeof import("./updates.js").getCurrentUpdateStatus;
let registerUpdatesIpc: typeof import("./updates.js").registerUpdatesIpc;

async function reloadUpdates() {
  ({ checkForAppUpdates, getCurrentUpdateStatus, registerUpdatesIpc } =
    await import("./updates.js"));
}

describe("desktop updates", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    electronState.app.isPackaged = true;
    electronState.app.getVersion.mockReturnValue("1.0.0");
    electronState.app.whenReady.mockImplementation(
      () => new Promise<void>(() => {}),
    );
    electronState.ipcMain.handlers.clear();
    updaterState.handlers.clear();
    updaterState.autoDownload = false;
    updaterState.autoInstallOnAppQuit = false;
    updaterState.checkForUpdates.mockReset();
    updaterState.downloadUpdate.mockReset();
    electronState.notification.isSupported.mockReturnValue(false);
    vi.resetModules();
    await reloadUpdates();
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
  });

  it("gives a Desktop SSO canary no updater network, download, install, or result-notification capability", async () => {
    electronState.app.getVersion.mockReturnValue(
      "0.1.150-desktop-sso-canary.4",
    );
    electronState.notification.isSupported.mockReturnValue(true);
    vi.resetModules();
    await reloadUpdates();
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
    });

    expect(getCurrentUpdateStatus()).toEqual({
      state: "unsupported",
      reason: "Auto-update is disabled for this Desktop SSO canary build",
    });
    expect(updaterState.setFeedURL).not.toHaveBeenCalled();
    expect(updaterState.on).not.toHaveBeenCalled();
    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();
    expect(electronState.app.whenReady).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();

    await electronState.ipcMain.handlers.get(IPC.UPDATE_CHECK)?.();
    await electronState.ipcMain.handlers.get(IPC.UPDATE_DOWNLOAD)?.();
    electronState.ipcMain.handlers.get(IPC.UPDATE_INSTALL)?.();

    expect(updaterState.checkForUpdates).not.toHaveBeenCalled();
    expect(updaterState.downloadUpdate).not.toHaveBeenCalled();
    expect(updaterState.quitAndInstall).not.toHaveBeenCalled();
    expect(electronState.notification).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it.each(["0.1.150", "0.1.150-beta.4"])(
    "preserves updater setup for %s",
    async (version) => {
      electronState.app.getVersion.mockReturnValue(version);
      electronState.app.whenReady.mockResolvedValue();
      updaterState.checkForUpdates.mockResolvedValue(undefined);
      vi.resetModules();
      await reloadUpdates();
      const intervalSpy = vi
        .spyOn(globalThis, "setInterval")
        .mockReturnValue({} as NodeJS.Timeout);

      registerUpdatesIpc({
        refreshApplicationMenu: vi.fn(),
        focusMainWindow: vi.fn(),
      });
      await vi.waitFor(() => {
        expect(updaterState.checkForUpdates).toHaveBeenCalledOnce();
      });

      expect(updaterState.setFeedURL).toHaveBeenCalledWith({
        provider: "generic",
        url: "https://agent-native.com/api/desktop-updates",
      });
      expect(updaterState.on).toHaveBeenCalled();
      expect(updaterState.autoDownload).toBe(true);
      expect(updaterState.autoInstallOnAppQuit).toBe(true);
      expect(intervalSpy).toHaveBeenCalled();
      intervalSpy.mockRestore();
    },
  );
});
