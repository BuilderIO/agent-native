import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }) => void>();
  return {
    browserWindow: {
      fromWebContents: vi.fn(),
    },
    ipcMain: {
      on: vi.fn(
        (channel: string, handler: (event: { sender: unknown }) => void) => {
          handlers.set(channel, handler);
        },
      ),
    },
    handlers,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronState.browserWindow,
  ipcMain: electronState.ipcMain,
}));

import { IPC } from "@shared/ipc-channels";

import { registerWindowIpc, toggleWindowMode } from "./window.js";

describe("desktop window controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.handlers.clear();
  });

  function createWindow({
    fullscreen = false,
    maximized = false,
  }: {
    fullscreen?: boolean;
    maximized?: boolean;
  } = {}) {
    return {
      isFullScreen: vi.fn(() => fullscreen),
      setFullScreen: vi.fn(),
      isMaximized: vi.fn(() => maximized),
      maximize: vi.fn(),
      restore: vi.fn(),
    };
  }

  it("toggles fullscreen mode on macOS", () => {
    const window = createWindow();

    toggleWindowMode(window, "darwin");

    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it("exits fullscreen mode on macOS", () => {
    const window = createWindow({ fullscreen: true });

    toggleWindowMode(window, "darwin");

    expect(window.setFullScreen).toHaveBeenCalledWith(false);
  });

  it("maximizes the window on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const window = createWindow();

      toggleWindowMode(window, platform);

      expect(window.maximize).toHaveBeenCalledOnce();
      expect(window.setFullScreen).not.toHaveBeenCalled();
    }
  });

  it("restores an already-maximized window on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const window = createWindow({ maximized: true });

      toggleWindowMode(window, platform);

      expect(window.restore).toHaveBeenCalledOnce();
    }
  });

  it("registers the platform-aware window mode command", () => {
    registerWindowIpc();

    expect(electronState.handlers.has(IPC.WINDOW_TOGGLE_WINDOW_MODE)).toBe(
      true,
    );
  });
});
