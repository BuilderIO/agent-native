import { IPC } from "@shared/ipc-channels";
import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

/** Registers the basic frameless-window control IPC handlers (minimize/maximize/close/is-maximized). */
export function registerWindowIpc(): void {
  ipcMain.on(IPC.WINDOW_MINIMIZE, (event: IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event: IpcMainEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.isMaximized() ? win.restore() : win.maximize();
  });

  ipcMain.on(IPC.WINDOW_CLOSE, (event: IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(
    IPC.WINDOW_IS_MAXIMIZED,
    (event: IpcMainInvokeEvent): boolean => {
      return (
        BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
      );
    },
  );
}
