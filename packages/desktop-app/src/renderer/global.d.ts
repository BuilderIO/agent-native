declare module "*.css" {}

/** Auto-update status surfaced from electron-updater (mirrors shared/ipc-channels.ts). */
type UpdateStatus =
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

/** Electron APIs exposed to the renderer via the preload contextBridge */
interface ElectronAPI {
  platform: string;

  windowControls: {
    minimize(): void;
    maximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (isMaximized: boolean) => void): () => void;
  };

  shortcuts: {
    onCloseTab(cb: () => void): () => void;
    onKeydown(
      cb: (info: { key: string; shiftKey: boolean; altKey?: boolean }) => void,
    ): () => void;
  };

  setActiveApp(appId: string): void;
  setActiveWebview(target: { appId: string; webContentsId?: number }): void;

  interApp: {
    send(targetAppId: string, event: string, data: unknown): void;
    on(cb: (from: string, event: string, data: unknown) => void): () => void;
  };

  frame: {
    load(): Promise<{
      enabled: boolean;
      mode: "dev" | "prod";
      prodUrl?: string;
    }>;
    update(settings: {
      enabled?: boolean;
      mode?: "dev" | "prod";
      prodUrl?: string;
    }): Promise<{
      enabled: boolean;
      mode: "dev" | "prod";
      prodUrl?: string;
    }>;
  };

  updater: {
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): void;
    getStatus(): Promise<UpdateStatus>;
    onStatusChange(cb: (status: UpdateStatus) => void): () => void;
  };

  appConfig: {
    load(): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    add(
      app: import("@agent-native/shared-app-config").AppConfig,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    remove(
      id: string,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    update(
      id: string,
      updates: Partial<import("@agent-native/shared-app-config").AppConfig>,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    reset(): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
  };
}

declare interface Window {
  electronAPI: ElectronAPI;
}

/** Extend JSX to support Electron's <webview> custom element */
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      src?: string;
      partition?: string;
      allowpopups?: boolean;
      webpreferences?: string;
      useragent?: string;
      disablewebsecurity?: string;
    };
  }
}

/** Minimal Electron WebviewTag interface for ref usage */
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  reload(): void;
  reloadIgnoringCache(): void;
  getWebContentsId(): number;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  openDevTools(): void;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): void;
  stopFindInPage(
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
}
