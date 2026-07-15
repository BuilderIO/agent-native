import type { AppConfig } from "@shared/app-registry";
import {
  IPC,
  type DesktopAppContextAction,
  type DesktopAppCreationSettings,
  type DesktopCreateAppRequest,
  type DesktopCreateAppResult,
  type LocalAppFolderSelectResult,
  type ProtectedPreviewAccessStatus,
} from "@shared/ipc-channels";
import { ipcMain, session, type IpcMainInvokeEvent } from "electron";

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

async function clearProtectedPreviewCookies(
  appId: string,
  origin: string,
): Promise<void> {
  const previewSession = session.fromPartition(`persist:app-${appId}`);
  const cookies = await previewSession.cookies.get({ url: origin });
  await Promise.all(
    cookies.map((cookie) =>
      previewSession.cookies.remove(
        new URL(cookie.path || "/", origin).toString(),
        cookie.name,
      ),
    ),
  );
}

async function clearAppBrowserCookies(appId: string): Promise<void> {
  await session
    .fromPartition(`persist:app-${appId}`)
    .clearStorageData({ storages: ["cookies"] });
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
    IPC.PROTECTED_PREVIEW_GET,
    (_event: IpcMainInvokeEvent, appId: string): ProtectedPreviewAccessStatus =>
      AppStore.getProtectedPreviewAccessStatus(appId),
  );

  ipcMain.handle(
    IPC.PROTECTED_PREVIEW_SAVE,
    (
      _event: IpcMainInvokeEvent,
      appId: string,
      origin: string,
      secret: string,
    ): ProtectedPreviewAccessStatus =>
      AppStore.saveProtectedPreviewAccess(appId, origin, secret),
  );

  ipcMain.handle(
    IPC.PROTECTED_PREVIEW_CLEAR,
    async (
      _event: IpcMainInvokeEvent,
      appId: string,
    ): Promise<ProtectedPreviewAccessStatus> => {
      const access = AppStore.loadProtectedPreviewAccess(appId);
      const app = AppStore.loadApps().find(
        (candidate) => candidate.id === appId,
      );
      const status = AppStore.clearProtectedPreviewAccess(appId);
      let cleanupError: string | undefined;

      if (access) {
        try {
          await clearProtectedPreviewCookies(appId, access.origin);
        } catch {
          cleanupError =
            "Preview access was cleared, but its persisted browser session could not be removed.";
        }
      }

      if (access && app?.devUrl && app.devPort) {
        try {
          if (new URL(app.devUrl).origin === access.origin) {
            AppStore.updateApp(appId, {
              devUrl: `http://localhost:${app.devPort}`,
              mode: "dev",
            });
          }
        } catch {
          // Invalid legacy dev URLs are left untouched.
        }
      }

      const restoreApp = AppStore.loadApps().find(
        (candidate) => candidate.id === appId,
      );
      return {
        ...status,
        ...(restoreApp ? { restoreApp } : {}),
        ...(cleanupError ? { error: cleanupError } : {}),
      };
    },
  );

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
    async (_event: IpcMainInvokeEvent, id: string): Promise<AppConfig[]> => {
      stopManagedDesktopApp(id);
      AppStore.invalidateProtectedPreviewAccess(id);
      await clearAppBrowserCookies(id);
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

  ipcMain.handle(IPC.APPS_RESET, async (): Promise<AppConfig[]> => {
    const configuredAppIds = AppStore.loadApps().map((app) => app.id);
    for (const appId of configuredAppIds) {
      AppStore.invalidateProtectedPreviewAccess(appId);
    }
    for (const appId of getManagedDesktopAppIds()) {
      stopManagedDesktopApp(appId);
    }
    await Promise.all(configuredAppIds.map(clearAppBrowserCookies));
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
