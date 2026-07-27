import {
  IPC,
  type DesktopShortcutSettings,
  type DesktopShortcutUpdateResult,
  type DesktopShortcutUpsertRequest,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import * as AppStore from "../app-store";

export interface ShortcutsIpcDeps {
  /** Reads the current shortcut bindings + accelerator conflicts from disk state. */
  getDesktopShortcutSettings: () => DesktopShortcutSettings;
  /** Re-registers the OS-level global shortcut accelerators after a change. */
  registerDesktopShortcutBindings: () => void;
}

/** Registers the local app-launch shortcut load/upsert/remove IPC handlers. */
export function registerShortcutsIpc(deps: ShortcutsIpcDeps): void {
  const { getDesktopShortcutSettings, registerDesktopShortcutBindings } = deps;

  ipcMain.handle(IPC.SHORTCUTS_LOAD, (): DesktopShortcutSettings => {
    return getDesktopShortcutSettings();
  });

  ipcMain.handle(
    IPC.SHORTCUTS_UPSERT,
    (
      _event: IpcMainInvokeEvent,
      request: DesktopShortcutUpsertRequest,
    ): DesktopShortcutUpdateResult => {
      const result = AppStore.upsertDesktopShortcutBinding(request);
      if (!result.ok) {
        return {
          ok: false,
          settings: getDesktopShortcutSettings(),
          error: result.error,
        };
      }
      registerDesktopShortcutBindings();
      return { ok: true, settings: getDesktopShortcutSettings() };
    },
  );

  ipcMain.handle(
    IPC.SHORTCUTS_REMOVE,
    (_event: IpcMainInvokeEvent, id: string): DesktopShortcutUpdateResult => {
      AppStore.removeDesktopShortcutBinding(id);
      registerDesktopShortcutBindings();
      return { ok: true, settings: getDesktopShortcutSettings() };
    },
  );
}
