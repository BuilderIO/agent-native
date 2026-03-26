import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type ActiveWebviewTarget,
  type InterAppMessage,
} from "@shared/ipc-channels";

/** The API surface exposed to the renderer via window.electronAPI */
const electronAPI = {
  /** Current OS platform — used by renderer to adapt UI (e.g. traffic lights vs custom controls) */
  platform: process.platform as string,

  /** Window chrome controls */
  windowControls: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

    /** Subscribe to maximize/restore state changes. Returns an unsubscribe fn. */
    onMaximizedChange: (cb: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, value: boolean) =>
        cb(value);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
    },
  },

  /** Shortcuts forwarded from the main process */
  shortcuts: {
    onCloseTab: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on("shortcut:close-tab", handler);
      return () => ipcRenderer.removeListener("shortcut:close-tab", handler);
    },

    /** Generic shortcut forwarding from webview guests */
    onKeydown: (
      cb: (info: { key: string; shiftKey: boolean }) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        info: { key: string; shiftKey: boolean },
      ) => cb(info);
      ipcRenderer.on("shortcut:keydown", handler);
      return () => ipcRenderer.removeListener("shortcut:keydown", handler);
    },
  },

  /** App config management */
  appConfig: {
    load: (): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_LOAD),
    add: (app: any): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_ADD, app),
    remove: (id: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC.APPS_REMOVE, id),
    update: (id: string, updates: any): Promise<any[]> =>
      ipcRenderer.invoke(IPC.APPS_UPDATE, id, updates),
    reset: (): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_RESET),
  },

  /** Tell main process which app webview is currently active (for DevTools targeting) */
  setActiveApp: (appId: string) => ipcRenderer.send(IPC.SET_ACTIVE_APP, appId),
  setActiveWebview: (target: ActiveWebviewTarget) =>
    ipcRenderer.send(IPC.SET_ACTIVE_WEBVIEW, target),

  /** Inter-app communication — relay messages between loaded apps */
  interApp: {
    /** Send a message to a specific app (or broadcast with targetAppId = "*") */
    send: (targetAppId: string, event: string, data: unknown) => {
      const msg: InterAppMessage = {
        from: "shell",
        targetAppId,
        event,
        data,
      };
      ipcRenderer.send(IPC.INTER_APP_SEND, msg);
    },

    /** Subscribe to inter-app messages. Returns an unsubscribe fn. */
    on: (
      cb: (from: string, event: string, data: unknown) => void,
    ): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, msg: InterAppMessage) => {
        cb(msg.from, msg.event, msg.data);
      };
      ipcRenderer.on(IPC.INTER_APP_MESSAGE, handler);
      return () => ipcRenderer.removeListener(IPC.INTER_APP_MESSAGE, handler);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
