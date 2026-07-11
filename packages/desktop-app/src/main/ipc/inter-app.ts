import { IPC, type InterAppMessage } from "@shared/ipc-channels";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";

/**
 * Registers the inter-app message relay: routes a message sent from one app's
 * webview to every renderer window so all webviews can forward it onward.
 */
export function registerInterAppIpc(): void {
  ipcMain.on(
    IPC.INTER_APP_SEND,
    (_event: IpcMainEvent, msg: InterAppMessage) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(IPC.INTER_APP_MESSAGE, msg);
      });
    },
  );
}
