import type { AppConfig } from "@shared/app-registry";
import {
  IPC,
  type DesktopAppContextAction,
  type DesktopAppCreationSettings,
  type DesktopCreateAppRequest,
  type DesktopCreateAppResult,
  type LocalAppFolderSelectResult,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import * as AppStore from "../app-store";

export interface AppsIpcDeps {
  /** Ids of currently-running managed local dev-server child processes. */
  getManagedDesktopAppIds: () => string[];
  stopManagedDesktopApp: (appId: string) => void;
  refreshDesktopShortcutBindings: () => void;
  chooseLocalAppFolder: () => Promise<LocalAppFolderSelectResult>;
  desktopAppCreationSettings: () => DesktopAppCreationSettings;
  normalizeDesktopAppsRoot: (value: unknown) => string | null;
  createDesktopAppFromPrompt: (
    input: DesktopCreateAppRequest,
  ) => Promise<DesktopCreateAppResult>;
  showDesktopAppContextMenu: (
    appId: string,
  ) => Promise<DesktopAppContextAction | null>;
}

/** Registers the app-config (sidebar app list) CRUD and creation IPC handlers. */
export function registerAppsIpc(deps: AppsIpcDeps): void {
  const {
    getManagedDesktopAppIds,
    stopManagedDesktopApp,
    refreshDesktopShortcutBindings,
    chooseLocalAppFolder,
    desktopAppCreationSettings,
    normalizeDesktopAppsRoot,
    createDesktopAppFromPrompt,
    showDesktopAppContextMenu,
  } = deps;

  ipcMain.handle(IPC.APPS_LOAD, (): AppConfig[] => {
    return AppStore.loadApps();
  });

  ipcMain.handle(
    IPC.APPS_ADD,
    (_event: IpcMainInvokeEvent, app: AppConfig): AppConfig[] => {
      const apps = AppStore.addApp(app);
      refreshDesktopShortcutBindings();
      return apps;
    },
  );

  ipcMain.handle(
    IPC.APPS_REMOVE,
    (_event: IpcMainInvokeEvent, id: string): AppConfig[] => {
      stopManagedDesktopApp(id);
      const apps = AppStore.removeApp(id);
      refreshDesktopShortcutBindings();
      return apps;
    },
  );

  ipcMain.handle(
    IPC.APPS_UPDATE,
    (
      _event: IpcMainInvokeEvent,
      id: string,
      updates: Partial<AppConfig>,
    ): AppConfig[] => {
      const apps = AppStore.updateApp(id, updates);
      refreshDesktopShortcutBindings();
      return apps;
    },
  );

  ipcMain.handle(
    IPC.APPS_REORDER,
    (
      _event: IpcMainInvokeEvent,
      id: string,
      direction: "up" | "down",
    ): AppConfig[] => AppStore.reorderApp(id, direction),
  );

  ipcMain.handle(IPC.APPS_RESET, (): AppConfig[] => {
    for (const appId of getManagedDesktopAppIds()) {
      stopManagedDesktopApp(appId);
    }
    const apps = AppStore.resetToDefaults();
    refreshDesktopShortcutBindings();
    return apps;
  });

  ipcMain.handle(
    IPC.APPS_CHOOSE_LOCAL_FOLDER,
    (): Promise<LocalAppFolderSelectResult> => chooseLocalAppFolder(),
  );

  ipcMain.handle(
    IPC.APPS_GET_CREATION_SETTINGS,
    (): DesktopAppCreationSettings => desktopAppCreationSettings(),
  );

  ipcMain.handle(
    IPC.APPS_UPDATE_CREATION_SETTINGS,
    (
      _event: IpcMainInvokeEvent,
      settings: Partial<DesktopAppCreationSettings>,
    ): DesktopAppCreationSettings => {
      const appsRoot = normalizeDesktopAppsRoot(settings?.appsRoot);
      if (!appsRoot) return desktopAppCreationSettings();
      AppStore.saveDesktopAppPreferences({ appsRoot });
      return { appsRoot };
    },
  );

  ipcMain.handle(
    IPC.APPS_CREATE_FROM_PROMPT,
    (
      _event: IpcMainInvokeEvent,
      input: DesktopCreateAppRequest,
    ): Promise<DesktopCreateAppResult> => createDesktopAppFromPrompt(input),
  );

  ipcMain.handle(
    IPC.APPS_SHOW_CONTEXT_MENU,
    (
      _event: IpcMainInvokeEvent,
      appId: string,
    ): Promise<DesktopAppContextAction | null> =>
      showDesktopAppContextMenu(appId),
  );
}
