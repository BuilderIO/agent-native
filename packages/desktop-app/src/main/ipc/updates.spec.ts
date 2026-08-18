import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    app: {
      isPackaged: true,
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
    notification: Object.assign(vi.fn(), {
      isSupported: vi.fn(() => false),
    }),
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

describe("desktop updates", () => {
  let checkForAppUpdates: typeof import("./updates.js").checkForAppUpdates;
  let getCurrentUpdateStatus: typeof import("./updates.js").getCurrentUpdateStatus;
  let registerUpdatesIpc: typeof import("./updates.js").registerUpdatesIpc;

  beforeEach(async () => {
    vi.clearAllMocks();
    electronState.ipcMain.handlers.clear();
    updaterState.handlers.clear();
    updaterState.checkForUpdates.mockReset();
    updaterState.downloadUpdate.mockReset();
    updaterState.quitAndInstall.mockReset();
    vi.resetModules();
    ({ checkForAppUpdates, getCurrentUpdateStatus, registerUpdatesIpc } =
      await import("./updates.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts transport details from a failed update check", async () => {
    const error = new Error(
      '502 "method: GET url: https://www.agent-native.com/api/desktop-updates/latest-mac.yml"',
    );
    updaterState.checkForUpdates.mockRejectedValue(error);
    const refreshApplicationMenu = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    registerUpdatesIpc({
      refreshApplicationMenu,
      focusMainWindow: vi.fn(),
    });

    await expect(checkForAppUpdates()).resolves.toEqual({
      state: "error",
      message: "Couldn't check for updates. Please try again.",
    });

    expect(getCurrentUpdateStatus()).toEqual({
      state: "error",
      message: "Couldn't check for updates. Please try again.",
    });
    expect(refreshApplicationMenu).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[updates] update operation failed:",
      error.message,
    );
    expect(electronState.ipcMain.handlers.has(IPC.UPDATE_CHECK)).toBe(true);
  });
});
