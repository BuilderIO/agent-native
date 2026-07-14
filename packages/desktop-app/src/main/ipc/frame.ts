import { IPC } from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import * as AppStore from "../app-store";

/** Registers the Frame (embedded browser chrome) settings load/update IPC handlers. */
export function registerFrameIpc(): void {
  ipcMain.handle(IPC.FRAME_LOAD, () => {
    return AppStore.loadFrameSettings();
  });

  ipcMain.handle(
    IPC.FRAME_UPDATE,
    (_event: IpcMainInvokeEvent, settings: Partial<AppStore.FrameSettings>) => {
      return AppStore.saveFrameSettings(settings);
    },
  );
}
