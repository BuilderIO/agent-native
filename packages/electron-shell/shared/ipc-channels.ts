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
} as const;

export interface InterAppMessage {
  from: string;
  targetAppId: string;
  event: string;
  data: unknown;
}
