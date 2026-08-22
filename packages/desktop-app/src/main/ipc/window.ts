import { IPC } from "@shared/ipc-channels";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";

type WindowModeTarget = Pick<
  BrowserWindow,
  "isFullScreen" | "setFullScreen" | "isMaximized" | "maximize" | "restore"
>;

export function toggleWindowMode(
  window: WindowModeTarget,
  platform = process.platform,
): void {
  if (platform === "darwin") {
    window.setFullScreen(!window.isFullScreen());
    return;
  }

  window.isMaximized() ? window.restore() : window.maximize();
}

/** Registers the basic frameless-window control IPC handlers. */
export function registerWindowIpc(): void {
  ipcMain.on(IPC.WINDOW_MINIMIZE, (event: IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.WINDOW_TOGGLE_WINDOW_MODE, (event: IpcMainEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    toggleWindowMode(win);
  });

  ipcMain.on(IPC.WINDOW_CLOSE, (event: IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on(
    IPC.WINDOW_NATIVE_BUTTONS_VISIBILITY,
    (event: IpcMainEvent, visible: unknown) => {
      if (process.platform !== "darwin" || typeof visible !== "boolean") {
        return;
      }
      BrowserWindow.fromWebContents(event.sender)?.setWindowButtonVisibility(
        visible,
      );
    },
  );
}
