/** IPC channel names shared between main, preload, and renderer. */
export const IPC = {
  /** Window control channels (renderer → main) */
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",

  /** Window state query (renderer ↔ main) */
  WINDOW_IS_MAXIMIZED: "window:is-maximized",

  /** Window state broadcast (main → renderer) */
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed",

  /** Inter-app message relay (renderer → main → renderer) */
  INTER_APP_SEND: "inter-app:send",
  INTER_APP_MESSAGE: "inter-app:message",

  /** App status events (main → renderer) */
  APP_STATUS: "app:status",

  /** App config management (renderer ↔ main) */
  APPS_LOAD: "apps:load",
  APPS_ADD: "apps:add",
  APPS_REMOVE: "apps:remove",
  APPS_UPDATE: "apps:update",
  APPS_RESET: "apps:reset",

  /** Active webview tracking (renderer → main) */
  SET_ACTIVE_APP: "webview:set-active-app",
  SET_ACTIVE_WEBVIEW: "webview:set-active-webview",

  /** Frame settings (renderer ↔ main) */
  FRAME_LOAD: "frame:load",
  FRAME_UPDATE: "frame:update",

  /** Auto-update (renderer ↔ main) */
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL: "update:install",
  UPDATE_GET_STATUS: "update:get-status",
  /** Broadcast (main → renderer) */
  UPDATE_STATUS_CHANGED: "update:status-changed",
} as const;

/** Auto-update status surfaced from electron-updater. */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "unsupported"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "not-available"; currentVersion: string }
  | {
      state: "downloading";
      percent: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    }
  | { state: "downloaded"; version: string; releaseNotes?: string }
  | { state: "error"; message: string };

export interface ActiveWebviewTarget {
  appId: string;
  webContentsId?: number;
}

export interface InterAppMessage {
  from: string;
  targetAppId: string;
  event: string;
  data: unknown;
}
