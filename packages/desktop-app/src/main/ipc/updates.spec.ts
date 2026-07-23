import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcHandlers,
    app: {
      isPackaged: true,
      getVersion: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
    },
    autoUpdater: {
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      downloadUpdate: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
    },
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        mocks.ipcHandlers.set(channel, handler);
      },
    ),
  },
  Notification: Object.assign(
    vi.fn(() => ({ on: vi.fn(), show: vi.fn() })),
    { isSupported: vi.fn(() => false) },
  ),
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));

describe("Desktop updater registration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.ipcHandlers.clear();
    mocks.app.isPackaged = true;
    mocks.autoUpdater.autoDownload = false;
    mocks.autoUpdater.autoInstallOnAppQuit = false;
  });

  it("gives a Desktop SSO canary no updater network, download, or install capability", async () => {
    mocks.app.getVersion.mockReturnValue("0.1.150-desktop-sso-canary.4");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const { getCurrentUpdateStatus, registerUpdatesIpc } =
      await import("./updates.js");

    registerUpdatesIpc({
      refreshApplicationMenu: vi.fn(),
      focusMainWindow: vi.fn(),
    });

    expect(getCurrentUpdateStatus()).toEqual({
      state: "unsupported",
      reason: "Auto-update is disabled for this Desktop SSO canary build",
    });
    expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();

    await mocks.ipcHandlers.get("update:check")?.();
    await mocks.ipcHandlers.get("update:download")?.();
    mocks.ipcHandlers.get("update:install")?.();

    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it.each(["0.1.150", "0.1.150-beta.4"])(
    "preserves updater setup for %s",
    async (version) => {
      mocks.app.getVersion.mockReturnValue(version);
      const intervalSpy = vi
        .spyOn(globalThis, "setInterval")
        .mockReturnValue({} as NodeJS.Timeout);
      const { registerUpdatesIpc } = await import("./updates.js");

      registerUpdatesIpc({
        refreshApplicationMenu: vi.fn(),
        focusMainWindow: vi.fn(),
      });
      await vi.waitFor(() => {
        expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
      });

      expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: "generic",
        url: "https://agent-native.com/api/desktop-updates",
      });
      expect(mocks.autoUpdater.on).toHaveBeenCalled();
      expect(mocks.autoUpdater.autoDownload).toBe(true);
      expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true);
      expect(intervalSpy).toHaveBeenCalled();
      intervalSpy.mockRestore();
    },
  );
});
