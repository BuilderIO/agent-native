import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
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
    notification: {
      isSupported: vi.fn(() => false),
    },
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

import {
  checkForAppUpdates,
  getCurrentUpdateStatus,
  registerUpdatesIpc,
} from "./updates.js";

describe("desktop updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const updateDownloaded = updaterState.handlers.get("update-downloaded");
    updateDownloaded?.({ version: "1.1.0", releaseNotes: "Fixes" });

    const checkPromise = checkForAppUpdates();
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
});
